/**
 * Session 2 (CODE_REVIEW.md 4.3) — batchOtpImport() must:
 *   1. Batch its station/checklist lookups (one findMany per chunk instead of
 *      one findFirst per row) — station.findFirst / checklist.findFirst must
 *      never be called.
 *   2. Wrap each ROW's writes in its own $transaction, so one bad row can't
 *      poison the rest of the batch — a failed row is reported individually
 *      and doesn't stop the remaining rows from importing.
 *   3. Resolve duplicate rows in one payload deterministically: the station a
 *      later row resolves to must be the one an earlier row in the same batch
 *      already created (no second station.create for the same key).
 *
 * Testing strategy for atomicity is the same as approve/reject: with a mocked
 * PrismaService, a live DB's automatic rollback-on-throw isn't observable, so
 * these tests verify every write is routed through the tx-scoped client
 * (never the root client) and that a per-row failure is caught and reported
 * without aborting the loop.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import type { OtpRowDto } from '../dto/otp-row.dto'

function makeRow(nameTh: string, opts?: { lastInspected?: string; province?: string }): OtpRowDto {
  return {
    station: {
      nameTh,
      name: nameTh,
      mode: 'ทางบก',
      province: opts?.province ?? 'กรุงเทพมหานคร',
      region: 'กลาง',
      responsibleAgency: 'ขบ.',
      lat: 13.75,
      lng: 100.5,
    },
    items: [],
    score: 80,
    status: 'ผ่านมาตรฐาน',
    lastInspected: opts?.lastInspected ?? '2026-03-01',
  } as unknown as OtpRowDto
}

describe('StationsService.batchOtpImport — chunking, transactions, batched lookups', () => {
  let service: StationsService

  const stationFindMany = jest.fn()
  const stationFindFirst = jest.fn(() => {
    throw new Error('station.findFirst must not be called — lookups must be batched via findMany')
  })
  const checklistFindMany = jest.fn()
  const checklistFindFirst = jest.fn(() => {
    throw new Error('checklist.findFirst must not be called — lookups must be batched via findMany')
  })
  const txStationCreate = jest.fn()
  const txStationUpdate = jest.fn()
  const txChecklistCreate = jest.fn()
  const txChecklistUpdate = jest.fn()
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      station: { create: txStationCreate, update: txStationUpdate },
      checklist: { create: txChecklistCreate, update: txChecklistUpdate },
    }),
  )

  beforeEach(async () => {
    jest.clearAllMocks()
    stationFindMany.mockResolvedValue([])
    checklistFindMany.mockResolvedValue([])

    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            station: { findMany: stationFindMany, findFirst: stationFindFirst },
            checklist: { findMany: checklistFindMany, findFirst: checklistFindFirst },
            $transaction: transactionMock,
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('batches lookups: one station.findMany + one checklist.findMany per chunk, never findFirst', async () => {
    const rowA = makeRow('สถานี A') // brand new — no existing station
    const rowB = makeRow('สถานี B', { lastInspected: '2026-05-01' }) // existing station, existing APPROVED checklist same year

    stationFindMany.mockResolvedValue([
      { id: 'existing-b', mode: 'ทางบก', nameTh: 'สถานี B', province: 'กรุงเทพมหานคร', responsibleAgency: 'ขบ.', lastInspected: null },
    ])
    checklistFindMany.mockResolvedValue([
      { id: 'cl-b-2026', stationId: 'existing-b', submittedAt: new Date('2026-01-15'), status: 'APPROVED' },
    ])

    txStationCreate.mockResolvedValue({ id: 'new-a', nameTh: 'สถานี A', lastInspected: null })
    txChecklistCreate.mockResolvedValue({ id: 'cl-a-2026' })
    txChecklistUpdate.mockResolvedValue({})
    txStationUpdate.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, nameTh: where.id === 'new-a' ? 'สถานี A' : 'สถานี B' }),
    )

    const results = await service.batchOtpImport([rowA, rowB], 'admin-1')

    expect(stationFindMany).toHaveBeenCalledTimes(1)
    expect(checklistFindMany).toHaveBeenCalledTimes(1)
    expect(stationFindFirst).not.toHaveBeenCalled()
    expect(checklistFindFirst).not.toHaveBeenCalled()

    // Row A: no existing station -> create; no existing checklist -> create.
    expect(txStationCreate).toHaveBeenCalledTimes(1)
    expect(txChecklistCreate).toHaveBeenCalledTimes(1)
    // Row B: existing station -> no create; existing checklist -> update, not create.
    expect(txChecklistUpdate).toHaveBeenCalledTimes(1)

    expect(results).toEqual([
      { id: 'new-a', nameTh: 'สถานี A' },
      { id: 'existing-b', nameTh: 'สถานี B' },
    ])
    // Response contract: success entries carry exactly {id, nameTh} — no extra fields.
    for (const r of results) {
      expect(Object.keys(r).sort()).toEqual(['id', 'nameTh'])
    }
  })

  it('one bad row does not poison the batch — other rows import, the bad row is reported individually', async () => {
    const rows = [makeRow('สถานี 1'), makeRow('สถานี 2'), makeRow('สถานี 3')]

    txStationCreate
      .mockResolvedValueOnce({ id: 's1', nameTh: 'สถานี 1', lastInspected: null })
      .mockResolvedValueOnce({ id: 's2', nameTh: 'สถานี 2', lastInspected: null })
      .mockResolvedValueOnce({ id: 's3', nameTh: 'สถานี 3', lastInspected: null })
    txChecklistCreate
      .mockResolvedValueOnce({ id: 'cl1' })
      .mockRejectedValueOnce(new Error('db unavailable')) // row index 1 fails
      .mockResolvedValueOnce({ id: 'cl3' })
    const nameByStationId: Record<string, string> = { s1: 'สถานี 1', s2: 'สถานี 2', s3: 'สถานี 3' }
    txStationUpdate.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, nameTh: nameByStationId[where.id] }),
    )

    const results = await service.batchOtpImport(rows, 'admin-1')

    expect(results[0]).toEqual({ id: 's1', nameTh: 'สถานี 1' })
    expect(results[2]).toEqual({ id: 's3', nameTh: 'สถานี 3' })
    expect(results[1]).toMatchObject({ nameTh: 'สถานี 2', index: 1 })
    expect((results[1] as unknown as { error: string }).error).toContain('db unavailable')

    // The failed row's transaction never touched the root client — nothing
    // partial from row 2 escapes the rolled-back transaction.
    expect(auditLog).toHaveBeenCalledTimes(2) // only rows 1 and 3 succeeded
  })

  it('duplicate rows for the same new station resolve deterministically — later row updates the station the earlier row just created, not a second create', async () => {
    const rows = [makeRow('สถานีซ้ำ'), makeRow('สถานีซ้ำ')]

    txStationCreate.mockResolvedValueOnce({ id: 'dup-station', nameTh: 'สถานีซ้ำ', lastInspected: null })
    txChecklistCreate.mockResolvedValue({ id: 'cl-dup' })
    txStationUpdate.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, nameTh: 'สถานีซ้ำ' }),
    )

    const results = await service.batchOtpImport(rows, 'admin-1')

    // Only the FIRST row creates the station; the second resolves it from the
    // in-memory map populated by the first row's transaction — no second create.
    expect(txStationCreate).toHaveBeenCalledTimes(1)
    expect(results[0]).toEqual({ id: 'dup-station', nameTh: 'สถานีซ้ำ' })
    expect(results[1]).toEqual({ id: 'dup-station', nameTh: 'สถานีซ้ำ' })
  })

  it('chunks the batch — station.findMany runs once per chunk, not once per row', async () => {
    const CHUNK_SIZE = 50
    const rows = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => makeRow(`สถานี ${i}`))

    const nameByStationId = new Map<string, string>()
    txStationCreate.mockImplementation(({ data }: { data: { nameTh: string } }) => {
      const id = `id-${data.nameTh}`
      nameByStationId.set(id, data.nameTh)
      return Promise.resolve({ id, nameTh: data.nameTh, lastInspected: null })
    })
    txChecklistCreate.mockResolvedValue({ id: 'cl' })
    txStationUpdate.mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve({ id: where.id, nameTh: nameByStationId.get(where.id) }),
    )

    const results = await service.batchOtpImport(rows, 'admin-1')

    expect(stationFindMany).toHaveBeenCalledTimes(2) // ceil(51 / 50)
    expect(results).toHaveLength(CHUNK_SIZE + 1)
    expect(results.every(r => 'id' in r && 'nameTh' in r)).toBe(true)
  })
})

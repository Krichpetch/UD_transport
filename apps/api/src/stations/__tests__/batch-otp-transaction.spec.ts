/**
 * Station masterlist cutover, import hardening (Task B3) — batchOtpImport() must:
 *   1. NEVER insert a Station. The masterlist is closed; every row is resolved against it
 *      via resolveStationMatch (exact -> normalized -> fuzzy, scoped within mode).
 *   2. Batch its station/checklist lookups (one findMany per chunk instead of one findFirst
 *      per row) — station.findFirst / checklist.findFirst must never be called, and
 *      station.create must never be called.
 *   3. Wrap each ROW's writes in its own $transaction, so one bad row can't poison the rest
 *      of the batch — a failed row is reported individually and doesn't stop the remaining
 *      rows from importing.
 *   4. Skip (never error, never insert) rows that only reach REVIEW or NOT_ON_MASTERLIST.
 *
 * Testing strategy for atomicity is the same as approve/reject: with a mocked PrismaService,
 * a live DB's automatic rollback-on-throw isn't observable, so these tests verify every write
 * is routed through the tx-scoped client (never the root client) and that a per-row failure is
 * caught and reported without aborting the loop.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import type { OtpRowDto } from '../dto/otp-row.dto'

function makeRow(nameTh: string, opts?: { lastInspected?: string; province?: string; mode?: string }): OtpRowDto {
  return {
    station: {
      nameTh,
      name: nameTh,
      mode: opts?.mode ?? 'ทางบก',
      province: opts?.province ?? 'กรุงเทพมหานคร',
      region: 'กลาง',
      responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)',
      lat: 13.75,
      lng: 100.5,
    },
    items: [],
    score: 80,
    status: 'ผ่านมาตรฐาน',
    lastInspected: opts?.lastInspected ?? '2026-03-01',
  } as unknown as OtpRowDto
}

function masterlistStation(id: string, nameTh: string, overrides: Partial<{ mode: string; line: string; responsibleAgency: string; lastInspected: Date | null }> = {}) {
  return {
    id, nameTh, mode: overrides.mode ?? 'ทางบก', line: overrides.line ?? '',
    responsibleAgency: overrides.responsibleAgency ?? 'กรมการขนส่งทางบก (ขบ.)', lastInspected: overrides.lastInspected ?? null,
  }
}

describe('StationsService.batchOtpImport — masterlist-only, never inserts', () => {
  let service: StationsService

  const stationFindMany = jest.fn()
  const stationFindFirst = jest.fn(() => {
    throw new Error('station.findFirst must not be called — lookups must be batched via findMany')
  })
  const stationCreate = jest.fn(() => {
    throw new Error('station.create must NEVER be called — the masterlist is closed')
  })
  const checklistFindMany = jest.fn()
  const checklistFindFirst = jest.fn(() => {
    throw new Error('checklist.findFirst must not be called — lookups must be batched via findMany')
  })
  const txStationUpdate = jest.fn()
  const txChecklistCreate = jest.fn()
  const txChecklistUpdate = jest.fn()
  const auditLog = jest.fn().mockResolvedValue(undefined)
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({
      station: { update: txStationUpdate, create: stationCreate },
      checklist: { create: txChecklistCreate, update: txChecklistUpdate },
    }),
  )

  beforeEach(async () => {
    jest.clearAllMocks()
    stationFindMany.mockResolvedValue([])
    checklistFindMany.mockResolvedValue([])
    txStationUpdate.mockResolvedValue({ responsibleAgency: 'กรมการขนส่งทางบก (ขบ.)' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            station: { findMany: stationFindMany, findFirst: stationFindFirst, create: stationCreate },
            checklist: { findMany: checklistFindMany, findFirst: checklistFindFirst },
            $transaction: transactionMock,
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('batches lookups: one station.findMany + one checklist.findMany per chunk, never findFirst, never create', async () => {
    const rowMatched = makeRow('สถานี B', { lastInspected: '2026-05-01' })
    const rowUnknown = makeRow('สถานีที่ไม่มีในบัญชีหลัก') // not on the masterlist at all

    stationFindMany.mockResolvedValue([masterlistStation('existing-b', 'สถานี B', { lastInspected: null })])
    checklistFindMany.mockResolvedValue([
      { id: 'cl-b-2026', stationId: 'existing-b', submittedAt: new Date('2026-01-15'), status: 'APPROVED' },
    ])
    txChecklistCreate.mockResolvedValue({ id: 'cl-b-new' })

    const results = await service.batchOtpImport([rowMatched, rowUnknown], 'admin-1')

    expect(stationFindMany).toHaveBeenCalledTimes(1)
    expect(checklistFindMany).toHaveBeenCalledTimes(1)
    expect(stationFindFirst).not.toHaveBeenCalled()
    expect(checklistFindFirst).not.toHaveBeenCalled()
    expect(stationCreate).not.toHaveBeenCalled()

    expect(results[0]).toEqual({ id: 'existing-b', nameTh: 'สถานี B' })
    expect(results[1]).toMatchObject({ skipped: true, reason: 'NOT_ON_MASTERLIST' })
    expect(auditLog).toHaveBeenCalledTimes(1) // only the matched row
  })

  it('one bad row does not poison the batch — other rows import, the bad row is reported individually', async () => {
    const rows = [makeRow('สถานี 1'), makeRow('สถานี 2'), makeRow('สถานี 3')]
    stationFindMany.mockResolvedValue([
      masterlistStation('s1', 'สถานี 1'), masterlistStation('s2', 'สถานี 2'), masterlistStation('s3', 'สถานี 3'),
    ])
    txChecklistCreate
      .mockResolvedValueOnce({ id: 'cl1' })
      .mockRejectedValueOnce(new Error('db unavailable')) // row index 1 fails
      .mockResolvedValueOnce({ id: 'cl3' })

    const results = await service.batchOtpImport(rows, 'admin-1')

    expect(results[0]).toEqual({ id: 's1', nameTh: 'สถานี 1' })
    expect(results[2]).toEqual({ id: 's3', nameTh: 'สถานี 3' })
    expect(results[1]).toMatchObject({ nameTh: 'สถานี 2', index: 1 })
    expect((results[1] as unknown as { error: string }).error).toContain('db unavailable')
    expect(stationCreate).not.toHaveBeenCalled()
    expect(auditLog).toHaveBeenCalledTimes(2) // only rows 1 and 3 succeeded
  })

  it('a row matching no masterlist station of that mode is skipped, never inserted', async () => {
    stationFindMany.mockResolvedValue([masterlistStation('rail1', 'สถานีกรุงเทพ', { mode: 'ทางราง' })])
    const results = await service.batchOtpImport([makeRow('สถานีกรุงเทพ', { mode: 'ทางบก' })], 'admin-1')

    // Same name, but wrong mode -- must not cross-match the rail station.
    expect(results[0]).toMatchObject({ skipped: true, reason: 'NOT_ON_MASTERLIST' })
    expect(stationCreate).not.toHaveBeenCalled()
    expect(txChecklistCreate).not.toHaveBeenCalled()
  })

  it('chunks the batch — station.findMany runs once per chunk, not once per row', async () => {
    const CHUNK_SIZE = 50
    const rows = Array.from({ length: CHUNK_SIZE + 1 }, (_, i) => makeRow(`สถานี ${i}`))
    stationFindMany.mockResolvedValue(rows.map((r, i) => masterlistStation(`id-${i}`, r.station.nameTh)))
    txChecklistCreate.mockResolvedValue({ id: 'cl' })

    const results = await service.batchOtpImport(rows, 'admin-1')

    expect(stationFindMany).toHaveBeenCalledTimes(2) // ceil(51 / 50)
    expect(results).toHaveLength(CHUNK_SIZE + 1)
    expect(stationCreate).not.toHaveBeenCalled()
    expect(results.every(r => 'id' in r && 'nameTh' in r)).toBe(true)
  })
})

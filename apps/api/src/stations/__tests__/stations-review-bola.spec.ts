/**
 * BOLA regression tests — rejectChecklist / setItemFlag / approveChecklist cross-station
 * authorization. Same fixture shape as stations-bola.spec.ts: STATION_A must never be able
 * to act on a checklist that actually belongs to STATION_B.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

const STATION_A = 'station-a-id'
const STATION_B = 'station-b-id'
const CHECKLIST_A = 'checklist-a-id'
const CHECKLIST_B = 'checklist-b-id'

const itemsB = [{ groupId: 'A1', groupName: '(A1) ที่จอดรถ', items: [{ id: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', reviewFlag: false }] }]

const checklistB = {
  id: CHECKLIST_B,
  stationId: STATION_B, // belongs to STATION_B
  auditorId: 'auditor-b',
  status: 'SUBMITTED' as const,
  items: itemsB,
}

const CHECKLIST_DB: Record<string, typeof checklistB> = { [CHECKLIST_B]: checklistB }

function simulateFindFirst({ where }: { where: { id: string; stationId?: string } }) {
  const record = CHECKLIST_DB[where.id]
  if (!record) return Promise.resolve(null)
  if (where.stationId !== undefined && record.stationId !== where.stationId) return Promise.resolve(null)
  return Promise.resolve(record)
}

describe('StationsService › BOLA: reject/flag cross-station authorization', () => {
  let service: StationsService
  let checklistFindFirst: jest.Mock
  let checklistUpdate: jest.Mock
  let checklistCreate: jest.Mock

  beforeEach(async () => {
    checklistFindFirst = jest.fn().mockImplementation(simulateFindFirst)
    checklistUpdate = jest.fn().mockResolvedValue(checklistB)
    checklistCreate = jest.fn().mockResolvedValue({})

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst: checklistFindFirst, update: checklistUpdate, create: checklistCreate },
            station: { update: jest.fn() },
            // approveChecklist/rejectChecklist now route their writes through
            // $transaction — reuse the same mocks as the tx client so these
            // cross-station authorization checks (which all fail before any
            // write) are unaffected.
            $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) =>
              cb({
                checklist: { findFirst: checklistFindFirst, update: checklistUpdate, create: checklistCreate },
                station: { update: jest.fn() },
              }),
            ),
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile()

    service = module.get<StationsService>(StationsService)
  })

  it('rejectChecklist: rejects a cross-station checklistId', async () => {
    await expect(
      service.rejectChecklist(STATION_A, CHECKLIST_B, 'ทางลาดชำรุด'),
    ).rejects.toThrow()
    expect(checklistUpdate).not.toHaveBeenCalled()
  })

  it('rejectChecklist: resolves for the correct station', async () => {
    await expect(
      service.rejectChecklist(STATION_B, CHECKLIST_B, 'ทางลาดชำรุด'),
    ).resolves.toBeDefined()
  })

  it('setItemFlag: rejects a cross-station checklistId', async () => {
    await expect(
      service.setItemFlag(STATION_A, CHECKLIST_B, 'A1.1', true),
    ).rejects.toThrow()
    expect(checklistUpdate).not.toHaveBeenCalled()
  })

  it('setItemFlag: resolves for the correct station', async () => {
    await expect(
      service.setItemFlag(STATION_B, CHECKLIST_B, 'A1.1', true),
    ).resolves.toBeDefined()
  })

  it('approveChecklist: blocks approval when an item has reviewFlag=true', async () => {
    checklistFindFirst.mockResolvedValueOnce({
      ...checklistB,
      items: [{ groupId: 'A1', groupName: '(A1) ที่จอดรถ', items: [{ id: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', reviewFlag: true }] }],
    })
    await expect(
      service.approveChecklist(STATION_B, CHECKLIST_B),
    ).rejects.toThrow()
    expect(checklistUpdate).not.toHaveBeenCalled()
  })
})

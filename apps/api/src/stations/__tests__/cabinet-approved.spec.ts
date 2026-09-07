/**
 * UDT-18 — StationsService.cabinetApprovedStationIds / cabinetApprovedIdsFromRows.
 *
 * Rule (decided with the user before implementation): a station "ผ่านมติ ครม." when every
 * non-N/A, non-redacted cabinet-priority leaf in its latest checklist is 'มี' AND meetsStandard,
 * and it has at least one such leaf to judge at all. Computed on the fly, no denormalized
 * Station column — same latest-checklist load computeMetrics/computeItemSummary use.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

function group(items: unknown[]) {
  return [{ groupId: 'A', groupName: 'A', items }]
}
function item(id: string, overrides: Record<string, unknown> = {}) {
  return { id, labelTh: id, value: 'มี', meetsStandard: true, cabinetPriority: false, note: '', photos: [], flagged: false, reviewFlag: false, ...overrides }
}

describe('StationsService.cabinetApprovedStationIds', () => {
  let service: StationsService
  const stationFindMany = jest.fn()
  const checklistFindMany = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            station: { findMany: stationFindMany },
            checklist: { findMany: checklistFindMany },
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(StationsService)
  })

  it('passes a station whose every cabinet-priority leaf is มี + meetsStandard', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('A1.1', { cabinetPriority: true, value: 'มี', meetsStandard: true }),
        item('A1.2', { cabinetPriority: true, value: 'มี', meetsStandard: true }),
        item('B1.1', { cabinetPriority: false, value: 'ไม่มี' }), // not cabinet-priority — irrelevant
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual(['s1'])
  })

  it('fails a station where one cabinet-priority leaf is มี but not meetsStandard', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('A1.1', { cabinetPriority: true, value: 'มี', meetsStandard: true }),
        item('A1.2', { cabinetPriority: true, value: 'มี', meetsStandard: false }),
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual([])
  })

  it('fails a station where a cabinet-priority leaf is ไม่มี', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('A1.1', { cabinetPriority: true, value: 'ไม่มี', meetsStandard: false }),
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual([])
  })

  it('ignores N/A cabinet-priority leaves — they neither block nor count as passing', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('A1.1', { cabinetPriority: true, value: 'มี', meetsStandard: true }),
        item('A1.2', { cabinetPriority: true, value: 'N/A' }),
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual(['s1'])
  })

  it('a station with zero cabinet-priority leaves at all is excluded, not counted as passing', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('B1.1', { cabinetPriority: false, value: 'มี', meetsStandard: true }),
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual([])
  })

  it('a station with no checklist at all is excluded', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual([])
  })

  it('an era-redacted cabinet-priority leaf is excluded like N/A', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([
        item('A1.1', { cabinetPriority: true, value: 'มี', meetsStandard: true }),
        item('A1.2', { cabinetPriority: true, value: 'ไม่มี', applicable: false }),
      ]), submittedAt: new Date() },
    ])

    const ids = await service.cabinetApprovedStationIds({})
    expect(ids).toEqual(['s1'])
  })
})

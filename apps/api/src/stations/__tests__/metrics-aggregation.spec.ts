/**
 * Session 3 (CODE_REVIEW.md 4.4) — StationsService.computeMetrics() replaces the dashboard's
 * per-station useQueries fan-out (1 + N requests) with one bounded server-side aggregation.
 *
 * Query strategy: exactly 2 Prisma calls regardless of station count —
 *   1. station.findMany({ where: <filters>, select: { id: true } }) to resolve the matching set
 *   2. checklist.findMany({ where: { stationId: {in}, status: {in: [SUBMITTED,APPROVED,REJECTED]} },
 *      distinct: ['stationId'], orderBy: [{stationId:'asc'},{submittedAt:'desc'}] }) — Postgres
 *      DISTINCT ON via distinct+matching orderBy prefix, giving "latest checklist per station"
 *      (any status, not just APPROVED) in one query — same selection dashboard's
 *      getLatestChecklist()/ChecklistsService.findLatest() already uses.
 *
 * Missing-data convention (resolved with the user before implementation, see
 * facility-metrics-parity.spec.ts): a station with no checklist, or whose latest checklist
 * doesn't contain the requested sub-item, contributes NOTHING — it is not counted in the
 * denominator at all (canonical/buildHistogram convention), unlike the old dashboard fan-out
 * which kept such stations in the total denominator.
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

describe('StationsService.computeMetrics', () => {
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

  it('runs exactly 2 Prisma queries regardless of station count', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }])
    checklistFindMany.mockResolvedValue([])

    await service.computeMetrics({})

    expect(stationFindMany).toHaveBeenCalledTimes(1)
    expect(checklistFindMany).toHaveBeenCalledTimes(1)
  })

  it('uses distinct+orderBy to fetch latest checklist per station, any of SUBMITTED/APPROVED/REJECTED', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }])
    checklistFindMany.mockResolvedValue([])

    await service.computeMetrics({})

    const call = checklistFindMany.mock.calls[0][0]
    expect(call.distinct).toEqual(['stationId'])
    expect(call.orderBy).toEqual([{ stationId: 'asc' }, { submittedAt: 'desc' }])
    expect(call.where.status).toEqual({ in: ['SUBMITTED', 'APPROVED', 'REJECTED'] })
  })

  it('empty station set (zero matches) → zeros, not NaN, and skips the checklist query', async () => {
    stationFindMany.mockResolvedValue([])

    const result = await service.computeMetrics({ mode: 'ทางอากาศ' })

    expect(checklistFindMany).not.toHaveBeenCalled()
    expect(result).toEqual({
      totalStations: 0,
      evaluatedStations: 0,
      metrics: { total: 0, hasItem: 0, meetsStandard: 0, pctSuccess: 0, pctHasFacility: 0, pctMeetsStandard: 0 },
      appliedFilters: { mode: 'ทางอากาศ' },
      failingStations: [],
    })
  })

  it('failingStations lists only stations where the sub-item is มี but not yet meetsStandard', async () => {
    stationFindMany.mockResolvedValue([
      { id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' },
      { id: 's2', nameTh: 'สถานี 2', province: 'เชียงใหม่' },
      { id: 's3', nameTh: 'สถานี 3', province: 'ภูเก็ต' },
    ])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([item('A1.1', { value: 'มี', meetsStandard: true })]), submittedAt: new Date() },
      { stationId: 's2', items: group([item('A1.1', { value: 'มี', meetsStandard: false })]), submittedAt: new Date() },
      { stationId: 's3', items: group([item('A1.1', { value: 'ไม่มี' })]), submittedAt: new Date() },
    ])

    const result = await service.computeMetrics({ subItem: 'A1.1' })

    expect(result.failingStations).toEqual([{ id: 's2', nameTh: 'สถานี 2', province: 'เชียงใหม่' }])
  })

  it('stations with no checklist at all are excluded from the denominator entirely', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    // Only s1 has a checklist; s2 has none.
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([item('A1.1', { value: 'มี', meetsStandard: true })]), submittedAt: new Date() },
    ])

    const result = await service.computeMetrics({ subItem: 'A1.1' })

    expect(result.totalStations).toBe(2)
    expect(result.metrics.total).toBe(1) // only s1 contributes — s2 is dropped, not counted as ไม่มี
    expect(result.metrics.hasItem).toBe(1)
  })

  it('subItem filtering matches the requested sub-item id across all groups, mirroring the old client-side lookup', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }])
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', items: group([item('A1.1', { value: 'มี', meetsStandard: true })]), submittedAt: new Date() },
      // s2's checklist doesn't contain A1.1 at all — must be dropped, not treated as ไม่มี.
      { stationId: 's2', items: group([item('B2.1', { value: 'มี', meetsStandard: false })]), submittedAt: new Date() },
    ])

    const result = await service.computeMetrics({ subItem: 'A1.1' })

    expect(result.metrics.total).toBe(1)
    expect(result.metrics.hasItem).toBe(1)
    expect(result.metrics.meetsStandard).toBe(1)
  })

  it('with no subItem, aggregates every item across all matching stations’ latest checklists', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }])
    checklistFindMany.mockResolvedValue([
      {
        stationId: 's1',
        items: group([
          item('A1.1', { value: 'มี', meetsStandard: true }),
          item('A1.2', { value: 'ไม่มี' }),
        ]),
        submittedAt: new Date(),
      },
    ])

    const result = await service.computeMetrics({})

    expect(result.metrics.total).toBe(2)
    expect(result.metrics.hasItem).toBe(1)
    expect(result.metrics.meetsStandard).toBe(1)
  })

  it('applies mode/region/province/responsibleAgency/railSubtype filters to the station query', async () => {
    stationFindMany.mockResolvedValue([])

    await service.computeMetrics({
      mode: 'ทางราง', railSubtype: 'รถไฟฟ้า', region: 'กลาง', province: 'กรุงเทพมหานคร', responsibleAgency: 'รฟม.',
    })

    expect(stationFindMany.mock.calls[0][0].where).toEqual({
      mode: 'ทางราง', railSubtype: 'รถไฟฟ้า', region: 'กลาง', province: 'กรุงเทพมหานคร', responsibleAgency: 'รฟม.',
    })
  })

  it('applies from/to as a submittedAt range on the checklist query', async () => {
    stationFindMany.mockResolvedValue([{ id: 's1' }])
    checklistFindMany.mockResolvedValue([])

    await service.computeMetrics({ from: '2026-01-01', to: '2026-06-30' })

    const where = checklistFindMany.mock.calls[0][0].where
    expect(where.submittedAt.gte).toEqual(new Date('2026-01-01'))
    expect(where.submittedAt.lte).toEqual(new Date('2026-06-30'))
  })
})

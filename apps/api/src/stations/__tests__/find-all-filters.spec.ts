/**
 * Regression test — findAll()'s new Part C filters: railSubtype, province, and the
 * checklist-item (subItem) filter that reuses computeMetrics()'s group-traversal
 * (findItemInGroups) rather than a second copy. Also covers the search+subItem
 * combination, which must AND (intersect) rather than let one silently overwrite the
 * other via a duplicate `where.id` key.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

function checklistRow(stationId: string, items: unknown) {
  return { stationId, items }
}

describe('StationsService.findAll — railSubtype/province/subItem filters', () => {
  let service: StationsService
  const stationFindMany = jest.fn().mockResolvedValue([])
  const stationCount = jest.fn().mockResolvedValue(0)
  const checklistFindMany = jest.fn().mockResolvedValue([])
  const queryRaw = jest.fn().mockResolvedValue([])

  beforeEach(async () => {
    jest.clearAllMocks()
    stationFindMany.mockResolvedValue([])
    stationCount.mockResolvedValue(0)
    checklistFindMany.mockResolvedValue([])
    queryRaw.mockResolvedValue([])
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            station: { findMany: stationFindMany, count: stationCount },
            checklist: { findMany: checklistFindMany },
            $queryRaw: queryRaw,
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('passes railSubtype straight through to the where clause', async () => {
    await service.findAll({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' })
    const call = stationFindMany.mock.calls[0][0]
    expect(call.where.mode).toBe('ทางราง')
    expect(call.where.railSubtype).toBe('รถไฟฟ้า')
  })

  it('passes province straight through to the where clause', async () => {
    await service.findAll({ province: 'กรุงเทพมหานคร' })
    expect(stationFindMany.mock.calls[0][0].where.province).toBe('กรุงเทพมหานคร')
  })

  it('filters by a named responsibleAgency with an exact match', async () => {
    await service.findAll({ responsibleAgency: 'การรถไฟแห่งประเทศไทย (รฟท.)' })
    expect(stationFindMany.mock.calls[0][0].where.responsibleAgency).toBe('การรถไฟแห่งประเทศไทย (รฟท.)')
  })

  it('filters by OTHER_AGENCY with notIn the 10 named agencies — catches raw non-canonical company names too, not just literal OTHER_AGENCY rows', async () => {
    await service.findAll({ responsibleAgency: 'หน่วยงานอื่นที่เกี่ยวข้อง' })
    const where = stationFindMany.mock.calls[0][0].where.responsibleAgency
    expect(where).toEqual({ notIn: expect.arrayContaining(['การรถไฟแห่งประเทศไทย (รฟท.)', 'บริษัท ทางด่วนและรถไฟฟ้ากรุงเทพ จำกัด (BEM)']) })
    expect(where.notIn).not.toContain('หน่วยงานอื่นที่เกี่ยวข้อง')
  })

  it('subItem filter: resolves matching stations via the shared group-traversal, not a fan-out', async () => {
    // Scoping query (stationIdsWithAnsweredItem's first call) returns 2 candidate stations.
    stationFindMany.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
    checklistFindMany.mockResolvedValueOnce([
      checklistRow('s1', [{ groupId: 'A', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'x', value: 'มี', meetsStandard: true }] }]),
      checklistRow('s2', [{ groupId: 'A', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'x', value: null }] }]),
    ])
    // Main list query (findAll's own findMany) — return value irrelevant here.
    stationFindMany.mockResolvedValueOnce([])

    await service.findAll({ subItem: 'A1.1' })

    // Exactly 2 station queries (scope + main list) and 1 checklist query — bounded, no fan-out.
    expect(stationFindMany).toHaveBeenCalledTimes(2)
    expect(checklistFindMany).toHaveBeenCalledTimes(1)
    // s1 answered ('มี'), s2 did not (null) — only s1 should survive into the main where.id filter.
    const mainCall = stationFindMany.mock.calls[1][0]
    expect(mainCall.where.id).toEqual({ in: ['s1'] })
  })

  it('excludes a station whose item value is N/A (not counted as answered)', async () => {
    stationFindMany.mockResolvedValueOnce([{ id: 's1' }])
    checklistFindMany.mockResolvedValueOnce([
      checklistRow('s1', [{ groupId: 'A', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'x', value: 'N/A' }] }]),
    ])
    stationFindMany.mockResolvedValueOnce([])

    await service.findAll({ subItem: 'A1.1' })
    expect(stationFindMany.mock.calls[1][0].where.id).toEqual({ in: [] })
  })

  it('combines search + subItem with AND (intersection), not a silent overwrite', async () => {
    // search resolves to {s1, s2}; subItem resolves to {s2, s3} -> intersection is {s2}.
    queryRaw.mockResolvedValueOnce([{ id: 's1' }, { id: 's2' }])
    stationFindMany.mockResolvedValueOnce([{ id: 's2' }, { id: 's3' }]) // subItem scope query
    checklistFindMany.mockResolvedValueOnce([
      checklistRow('s2', [{ groupId: 'A', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'x', value: 'มี' }] }]),
      checklistRow('s3', [{ groupId: 'A', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'x', value: 'มี' }] }]),
    ])
    stationFindMany.mockResolvedValueOnce([]) // main list query

    await service.findAll({ search: 'บางนา', subItem: 'A1.1' })

    const mainCall = stationFindMany.mock.calls[stationFindMany.mock.calls.length - 1][0]
    expect(mainCall.where.id).toEqual({ in: ['s2'] })
  })
})

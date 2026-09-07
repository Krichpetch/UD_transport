/**
 * UDT-17 — StationsService.computeIssueSummary ("ประเด็นที่ควรปรับปรุง"): ranks BOTH the
 * checklist's named facility groups (groupId/groupName — the "bigger picture" default view) and
 * individual leaf items (the drill-down option) by ร้อยละความสำเร็จ across the filtered station
 * set, worst-first, off the same latest-checklist load computeMetrics uses.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

function group(groupId: string, groupName: string, items: unknown[]) {
  return [{ groupId, groupName, items }]
}
function item(id: string, overrides: Record<string, unknown> = {}) {
  return { id, labelTh: id, value: 'มี', meetsStandard: true, cabinetPriority: false, note: '', photos: [], flagged: false, reviewFlag: false, ...overrides }
}

describe('StationsService.computeIssueSummary', () => {
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

  it('empty station set → zero totalStations, no groups/items, skips the checklist query', async () => {
    stationFindMany.mockResolvedValue([])

    const result = await service.computeIssueSummary({})

    expect(checklistFindMany).not.toHaveBeenCalled()
    expect(result).toEqual({ totalStations: 0, groups: [], items: [] })
  })

  describe('groups (bigger picture, default view)', () => {
    it('aggregates every leaf under its groupId across stations and sorts worst-first', async () => {
      stationFindMany.mockResolvedValue([
        { id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' },
        { id: 's2', nameTh: 'สถานี 2', province: 'เชียงใหม่' },
      ])
      checklistFindMany.mockResolvedValue([
        // (A1) ที่จอดรถ: 2/2 leaves meet standard → 100%.
        // (B2) ห้องน้ำ: 0/2 leaves meet standard → 0%. Should rank above (worse than) A1.
        {
          stationId: 's1',
          items: [
            ...group('A1', '(A1) ที่จอดรถ', [item('A1.1', { value: 'มี', meetsStandard: true })]),
            ...group('B2', '(B2) ห้องน้ำ', [item('B2.1', { value: 'มี', meetsStandard: false })]),
          ],
          submittedAt: new Date(),
        },
        {
          stationId: 's2',
          items: [
            ...group('A1', '(A1) ที่จอดรถ', [item('A1.1', { value: 'มี', meetsStandard: true })]),
            ...group('B2', '(B2) ห้องน้ำ', [item('B2.1', { value: 'มี', meetsStandard: false })]),
          ],
          submittedAt: new Date(),
        },
      ])

      const result = await service.computeIssueSummary({})

      expect(result.totalStations).toBe(2)
      expect(result.groups.map(g => g.groupId)).toEqual(['B2', 'A1'])
      expect(result.groups[0]).toMatchObject({ groupName: '(B2) ห้องน้ำ', category: 'B' })
      expect(result.groups[0].metrics.pctSuccess).toBe(0)
      expect(result.groups[1].metrics.pctSuccess).toBe(100)
    })

    it('a group with multiple leaves rolls them all into one aggregate', async () => {
      stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
      checklistFindMany.mockResolvedValue([
        {
          stationId: 's1',
          items: group('B2', '(B2) ห้องน้ำ', [
            item('B2.1', { value: 'มี', meetsStandard: true }),
            item('B2.2', { value: 'มี', meetsStandard: false }),
            item('B2.3', { value: 'ไม่มี' }),
          ]),
          submittedAt: new Date(),
        },
      ])

      const result = await service.computeIssueSummary({})

      expect(result.groups).toEqual([
        expect.objectContaining({ groupId: 'B2', metrics: expect.objectContaining({ total: 3, meetsStandard: 1 }) }),
      ])
    })

    it('marks cabinetPriority true when ANY leaf in the group is cabinet-priority', async () => {
      stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
      checklistFindMany.mockResolvedValue([
        {
          stationId: 's1',
          items: group('B2', '(B2) ห้องน้ำ', [
            item('B2.1', { value: 'มี', meetsStandard: true, cabinetPriority: true }),
            item('B2.2', { value: 'มี', meetsStandard: true, cabinetPriority: false }),
          ]),
          submittedAt: new Date(),
        },
      ])

      const result = await service.computeIssueSummary({})

      expect(result.groups[0].cabinetPriority).toBe(true)
    })

    it('omits a group with zero eligible samples (e.g. every leaf N/A)', async () => {
      stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
      checklistFindMany.mockResolvedValue([
        { stationId: 's1', items: group('A1', '(A1) ที่จอดรถ', [item('A1.1', { value: 'N/A' })]), submittedAt: new Date() },
      ])

      const result = await service.computeIssueSummary({})

      expect(result.groups).toEqual([])
    })
  })

  describe('items (drill-down option)', () => {
    it('still ranks individual leaf ids, worst-first', async () => {
      stationFindMany.mockResolvedValue([{ id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' }])
      checklistFindMany.mockResolvedValue([
        {
          stationId: 's1',
          items: [
            ...group('A1', '(A1) ที่จอดรถ', [item('A1.1', { value: 'มี', meetsStandard: true })]),
            ...group('B2', '(B2) ห้องน้ำ', [item('B2.1', { value: 'มี', meetsStandard: false })]),
          ],
          submittedAt: new Date(),
        },
      ])

      const result = await service.computeIssueSummary({})

      expect(result.items.map(i => i.id)).toEqual(['B2.1', 'A1.1'])
    })
  })

  it('cabinetApproved narrows to only cabinet-passing stations before grouping either way', async () => {
    stationFindMany.mockResolvedValue([
      { id: 's1', nameTh: 'สถานี 1', province: 'กรุงเทพมหานคร' },
      { id: 's2', nameTh: 'สถานี 2', province: 'เชียงใหม่' },
    ])
    checklistFindMany.mockResolvedValue([
      // s1 passes cabinet resolution.
      {
        stationId: 's1',
        items: [
          ...group('A1', '(A1) ที่จอดรถ', [item('A1.1', { cabinetPriority: true, value: 'มี', meetsStandard: true })]),
          ...group('B2', '(B2) ห้องน้ำ', [item('B2.1', { value: 'มี', meetsStandard: false })]),
        ],
        submittedAt: new Date(),
      },
      // s2 fails cabinet resolution — excluded entirely when cabinetApproved: true.
      {
        stationId: 's2',
        items: [
          ...group('A1', '(A1) ที่จอดรถ', [item('A1.1', { cabinetPriority: true, value: 'ไม่มี' })]),
          ...group('B2', '(B2) ห้องน้ำ', [item('B2.1', { value: 'มี', meetsStandard: true })]),
        ],
        submittedAt: new Date(),
      },
    ])

    const result = await service.computeIssueSummary({ cabinetApproved: true })

    const b2 = result.groups.find(g => g.groupId === 'B2')
    expect(b2?.metrics.total).toBe(1) // only s1 contributes
    expect(b2?.metrics.meetsStandard).toBe(0)
  })
})

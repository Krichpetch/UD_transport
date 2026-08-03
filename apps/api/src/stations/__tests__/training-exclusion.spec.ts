/**
 * Session S3b, Part A.4 — every StationsService aggregate/query touched by the training-mode
 * exclusion list (see CLAUDE.md/S3b spec Read-FIRST #5): admin stations list default view,
 * filter dropdowns, the auditor picker, /stations/metrics (covered separately in
 * metrics-aggregation.spec.ts), map nodes, the summary KPI cards, the pending-review queue, and
 * the export data source. Each must exclude Station/Checklist rows where isTraining is true,
 * unless explicitly opted back in (findAll's includeTraining toggle).
 */
import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService — Part A.4 training exclusion', () => {
  let service: StationsService
  const stationFindMany = jest.fn()
  const stationCount = jest.fn()
  const checklistFindMany = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    stationFindMany.mockResolvedValue([])
    stationCount.mockResolvedValue(0)
    checklistFindMany.mockResolvedValue([])

    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            station: { findMany: stationFindMany, count: stationCount },
            checklist: { findMany: checklistFindMany },
            $queryRaw: jest.fn().mockResolvedValue([]),
          },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(StationsService)
  })

  it('findAll excludes training stations by default', async () => {
    await service.findAll({})
    const where = stationFindMany.mock.calls[0][0].where
    expect(where.isTraining).toBe(false)
  })

  it('findAll includes training stations only when includeTraining is explicitly true', async () => {
    await service.findAll({ includeTraining: true })
    const where = stationFindMany.mock.calls[0][0].where
    expect(where.isTraining).toBeUndefined()
  })

  it('getFilterOptions excludes training stations from both region and province queries', async () => {
    await service.getFilterOptions()
    expect(stationFindMany.mock.calls[0][0].where).toMatchObject({ isTraining: false })
    expect(stationFindMany.mock.calls[1][0].where).toMatchObject({ scope: 'IN_SCOPE', isTraining: false })
  })

  it('searchSlim always excludes training stations from the auditor picker', async () => {
    await service.searchSlim({ limit: 20, page: 1 })
    expect(stationFindMany.mock.calls[0][0].where.isTraining).toBe(false)
  })

  it('searchSlim applies railSubtype only alongside mode=ทางราง (Part B)', async () => {
    await service.searchSlim({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า', limit: 20, page: 1 })
    expect(stationFindMany.mock.calls[0][0].where.railSubtype).toBe('รถไฟฟ้า')

    jest.clearAllMocks()
    stationFindMany.mockResolvedValue([])
    await service.searchSlim({ mode: 'ทางบก', railSubtype: 'รถไฟฟ้า', limit: 20, page: 1 })
    expect(stationFindMany.mock.calls[0][0].where.railSubtype).toBeUndefined()
  })

  it('findMapNodes always excludes training stations from the heatmap/map', async () => {
    await service.findMapNodes()
    expect(stationFindMany.mock.calls[0][0].where).toEqual({ isTraining: false })
  })

  it('summary excludes training stations from every KPI count', async () => {
    await service.summary()
    for (const call of stationCount.mock.calls) {
      expect(call[0]?.where?.isTraining).toBe(false)
    }
    expect(stationCount).toHaveBeenCalledTimes(4)
  })

  it('getPendingReviews excludes training checklists from the review queue', async () => {
    await service.getPendingReviews()
    const where = checklistFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ status: 'SUBMITTED', isTraining: false })
  })

  it('findAllForExport excludes training checklists from the export data source', async () => {
    await service.findAllForExport()
    const where = checklistFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ status: 'APPROVED', isTraining: false })
  })

  it('findTrainingStations returns only isTraining=true rows', async () => {
    await service.findTrainingStations()
    expect(stationFindMany.mock.calls[0][0].where).toEqual({ isTraining: true })
  })
})

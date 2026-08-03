/**
 * Session S3b, Part A.4 — the admin overview dashboard's 6 bounded queries must all exclude
 * training checklists/stations, same as every other aggregate on the exclusion list.
 */
import { Test } from '@nestjs/testing'
import { AdminService } from '../admin.service'
import { PrismaService } from '../../prisma/prisma.service'

describe('AdminService.getOverview — Part A.4 training exclusion', () => {
  let service: AdminService
  const checklistFindMany = jest.fn()
  const checklistCount = jest.fn()
  const stationCount = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistFindMany.mockResolvedValue([])
    checklistCount.mockResolvedValue(0)
    stationCount.mockResolvedValue(0)

    const moduleRef = await Test.createTestingModule({
      providers: [
        AdminService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findMany: checklistFindMany, count: checklistCount },
            station: { count: stationCount },
          },
        },
      ],
    }).compile()
    service = moduleRef.get(AdminService)
  })

  it('every checklist query excludes isTraining rows', async () => {
    await service.getOverview()
    for (const call of checklistFindMany.mock.calls) {
      expect(call[0].where.isTraining).toBe(false)
    }
    expect(checklistCount.mock.calls[0][0].where.isTraining).toBe(false)
  })

  it('the never-audited-in-scope and unconfirmed-coords station counts exclude training fixtures', async () => {
    await service.getOverview()
    for (const call of stationCount.mock.calls) {
      expect(call[0].where.isTraining).toBe(false)
    }
  })
})

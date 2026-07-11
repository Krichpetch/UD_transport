/**
 * Regression test — findAll() must clamp `limit` so an unbounded query
 * param (e.g. limit=9999) can't force one Prisma call to pull the whole
 * table. searchSlim()/findNearby() already cap at 50; findAll() didn't
 * cap at all.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.findAll — limit clamp', () => {
  let service: StationsService
  const findMany = jest.fn().mockResolvedValue([])
  const count = jest.fn().mockResolvedValue(0)

  beforeEach(async () => {
    jest.clearAllMocks()
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        { provide: PrismaService, useValue: { station: { findMany, count } } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('clamps an oversized limit to 100', async () => {
    await service.findAll({ limit: 9999 })
    expect(findMany.mock.calls[0][0].take).toBe(100)
  })

  it('leaves a normal limit untouched', async () => {
    await service.findAll({ limit: 20 })
    expect(findMany.mock.calls[0][0].take).toBe(20)
  })

  it('defaults to 20 when no limit is given', async () => {
    await service.findAll({})
    expect(findMany.mock.calls[0][0].take).toBe(20)
  })
})

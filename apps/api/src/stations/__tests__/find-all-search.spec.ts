/**
 * Regression test — findAll()'s `search` param must be resolved server-side against
 * nameTh, name, line, and province, normalized (whitespace/case) via the shared
 * normalizeKey() used by masterlist import matching. Before this fix, `line` was never
 * searched at all (the station-identity component the masterlist cutover added) and
 * plain `contains` matching broke on any spacing difference between the query and the
 * stored Thai text.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService.findAll — search', () => {
  let service: StationsService
  const findMany = jest.fn().mockResolvedValue([])
  const count = jest.fn().mockResolvedValue(0)
  const queryRaw = jest.fn().mockResolvedValue([])

  beforeEach(async () => {
    jest.clearAllMocks()
    findMany.mockResolvedValue([])
    count.mockResolvedValue(0)
    queryRaw.mockResolvedValue([])
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: { station: { findMany, count }, $queryRaw: queryRaw },
        },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(StationsService)
  })

  it('does not run a search query or filter by id when search is omitted', async () => {
    await service.findAll({})
    expect(queryRaw).not.toHaveBeenCalled()
    expect(findMany.mock.calls[0][0].where.id).toBeUndefined()
  })

  it('resolves search hits via the normalized raw query and filters findMany by id', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'station-1' }, { id: 'station-2' }])
    await service.findAll({ search: 'บางนา' })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: ['station-1', 'station-2'] })
  })

  it('matches a line-name query (e.g. a rail line) via the same search path', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'rail-station-1' }])
    await service.findAll({ search: 'สายสีเขียว' })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: ['rail-station-1'] })
  })

  it('is whitespace-insensitive: a query with extra spacing still triggers the search path', async () => {
    queryRaw.mockResolvedValueOnce([{ id: 'station-3' }])
    await service.findAll({ search: 'บาง นา' })
    expect(queryRaw).toHaveBeenCalledTimes(1)
    // normalizeKey strips all whitespace, so the ILIKE pattern passed to $queryRaw has none
    const sqlValues = queryRaw.mock.calls[0].slice(1) as unknown[]
    expect(sqlValues).toContain('%บางนา%')
  })

  it('returns zero rows (no query) for a whitespace-only search term', async () => {
    await service.findAll({ search: '   ' })
    expect(queryRaw).not.toHaveBeenCalled()
    expect(findMany.mock.calls[0][0].where.id).toEqual({ in: [] })
  })
})

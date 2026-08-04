/**
 * Session F3, Part A — rail line: identity, display, filter.
 *
 * Three things this locks down:
 *   1. searchSlim() (the auditor picker's backing query) now resolves `q` through the SAME
 *      normalized searchStationIds() path findAll uses, instead of the plain Prisma `contains`
 *      on nameTh/province it used before — which silently never searched `line` at all, the very
 *      component that distinguishes two same-named stations post-masterlist-cutover.
 *   2. The `line` filter narrows findAll/searchSlim by exact match and COMPOSES with
 *      mode/railSubtype/search/subItem rather than being overwritten by them.
 *   3. findLines() returns distinct, sorted, scoped values and never offers the empty-string
 *      "no line" sentinel as a filter option.
 */

import { Test } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

describe('StationsService — line (Session F3, Part A)', () => {
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

  // ── searchSlim: line is searched and selected ──────────────────────────────────────────────

  describe('searchSlim — search path', () => {
    it('selects `line` so a result row can render it', async () => {
      await service.searchSlim({ limit: 20, page: 1 })
      expect(findMany.mock.calls[0][0].select.line).toBe(true)
    })

    it('resolves a query through the normalized raw-SQL path, not a plain `contains`', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'station-1' }])
      await service.searchSlim({ q: 'บางนา', limit: 20, page: 1 })

      expect(queryRaw).toHaveBeenCalledTimes(1)
      expect(findMany.mock.calls[0][0].where.id).toEqual({ in: ['station-1'] })
      // The old predicate is gone — no OR-of-contains on nameTh/province any more.
      expect(findMany.mock.calls[0][0].where.OR).toBeUndefined()
    })

    it('matches a LINE-name query in the slim picker path (the Part A.1 gap)', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'metro-1' }, { id: 'metro-2' }])
      await service.searchSlim({ q: 'สายสีเขียว', limit: 20, page: 1 })

      expect(queryRaw).toHaveBeenCalledTimes(1)
      expect(findMany.mock.calls[0][0].where.id).toEqual({ in: ['metro-1', 'metro-2'] })
    })

    it('is whitespace-insensitive, exactly like findAll (one shared normalization)', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'station-3' }])
      await service.searchSlim({ q: 'สาย สีเขียว', limit: 20, page: 1 })

      const sqlValues = queryRaw.mock.calls[0].slice(1) as unknown[]
      expect(sqlValues).toContain('%สายสีเขียว%')
    })

    it('runs no search query when q is omitted', async () => {
      await service.searchSlim({ limit: 20, page: 1 })
      expect(queryRaw).not.toHaveBeenCalled()
      expect(findMany.mock.calls[0][0].where.id).toBeUndefined()
    })
  })

  // ── The line filter itself ─────────────────────────────────────────────────────────────────

  describe('line filter', () => {
    it('narrows findAll by exact match', async () => {
      await service.findAll({ line: 'สายสีเขียว' })
      expect(findMany.mock.calls[0][0].where.line).toBe('สายสีเขียว')
    })

    it('composes with mode/railSubtype in findAll rather than replacing them', async () => {
      await service.findAll({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า', line: 'สายสีน้ำเงิน' })
      const where = findMany.mock.calls[0][0].where
      expect(where.mode).toBe('ทางราง')
      expect(where.railSubtype).toBe('รถไฟฟ้า')
      expect(where.line).toBe('สายสีน้ำเงิน')
    })

    it('composes with search in findAll — the id filter does not clobber the line filter', async () => {
      queryRaw.mockResolvedValueOnce([{ id: 'station-9' }])
      await service.findAll({ line: 'สายสีแดง', search: 'รังสิต' })
      const where = findMany.mock.calls[0][0].where
      expect(where.line).toBe('สายสีแดง')
      expect(where.id).toEqual({ in: ['station-9'] })
    })

    it('scopes the subItem filter through line too (subItem shares scopeWhere)', async () => {
      // First findMany call inside stationIdsWithAnsweredItem resolves the scoped station set.
      findMany.mockResolvedValueOnce([])
      await service.findAll({ line: 'สายสีม่วง', subItem: 'ทางลาด' })
      expect(findMany.mock.calls[0][0].where.line).toBe('สายสีม่วง')
    })

    it('narrows searchSlim by exact match, alongside mode/railSubtype', async () => {
      await service.searchSlim({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า', line: 'สายสีเขียว', limit: 20, page: 1 })
      const where = findMany.mock.calls[0][0].where
      expect(where.mode).toBe('ทางราง')
      expect(where.railSubtype).toBe('รถไฟฟ้า')
      expect(where.line).toBe('สายสีเขียว')
    })

    it('is absent from the where clause when not supplied', async () => {
      await service.findAll({})
      expect(findMany.mock.calls[0][0].where.line).toBeUndefined()
    })
  })

  // ── findLines ──────────────────────────────────────────────────────────────────────────────

  describe('findLines', () => {
    it('returns distinct lines, sorted, scoped by mode, excluding training rows', async () => {
      findMany.mockResolvedValueOnce([
        { line: 'สายสีเขียว' },
        { line: 'สายสีน้ำเงิน' },
      ])
      const result = await service.findLines({ mode: 'ทางราง' })

      expect(result).toEqual(['สายสีเขียว', 'สายสีน้ำเงิน'])
      const args = findMany.mock.calls[0][0]
      expect(args.where.mode).toBe('ทางราง')
      expect(args.where.isTraining).toBe(false)
      expect(args.distinct).toEqual(['line'])
      expect(args.orderBy).toEqual({ line: 'asc' })
    })

    it('never offers the empty-string "no line" sentinel as an option', async () => {
      findMany.mockResolvedValueOnce([{ line: 'สายสีทอง' }])
      const result = await service.findLines({})

      // Enforced in the query itself, so an empty-string row can never reach the caller.
      expect(findMany.mock.calls[0][0].where.line).toEqual({ not: '' })
      expect(result).not.toContain('')
    })

    it('scopes by railSubtype only under ทางราง', async () => {
      await service.findLines({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' })
      expect(findMany.mock.calls[0][0].where.railSubtype).toBe('รถไฟฟ้า')

      findMany.mockClear()
      await service.findLines({ mode: 'ทางบก', railSubtype: 'รถไฟฟ้า' })
      expect(findMany.mock.calls[0][0].where.railSubtype).toBeUndefined()
    })

    it('returns an empty list for a scope with no lines (drives "hide the control")', async () => {
      findMany.mockResolvedValueOnce([])
      await expect(service.findLines({ mode: 'ทางอากาศ' })).resolves.toEqual([])
    })
  })
})

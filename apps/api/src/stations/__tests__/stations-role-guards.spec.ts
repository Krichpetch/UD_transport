/**
 * Role guard integration tests — stations.controller.ts (GET routes)
 *
 * All five GET routes currently have no role restriction beyond JwtAuthGuard.
 * CLAUDE.md rule: "All API endpoints must be role-guarded (ADMIN / AUDITOR / EXECUTIVE)"
 *
 * GET /stations              → ADMIN, EXECUTIVE, AUDITOR (explicit; KIOSK → 403)
 * GET /stations/filters      → ADMIN, EXECUTIVE, AUDITOR (explicit; KIOSK → 403)
 * GET /stations/:id          → ADMIN, EXECUTIVE, AUDITOR (explicit; KIOSK → 403)
 * GET /stations/summary      → ADMIN, EXECUTIVE only    (AUDITOR → 403)
 * GET /stations/pending-reviews → ADMIN only            (EXECUTIVE → 403, AUDITOR → 403)
 *
 * Tests marked ✗ FAIL with current code.
 * Tests marked ✓ pass in both states.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import request = require('supertest')
import { StationsController } from '../stations.controller'
import { StationsService } from '../stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const STATION_ID = 'station-test-id'

const mockGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest()
    const role = req.headers['x-test-role'] as string
    if (!role) return false
    req.user = { id: 'test-user-id', username: 'testuser', role }
    return true
  },
}

const mockStationsService = {
  findAll:           jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 0 }),
  getFilterOptions:  jest.fn().mockResolvedValue({ regions: [], agencies: [] }),
  findOne:           jest.fn().mockResolvedValue({ id: STATION_ID, nameTh: 'Test Station' }),
  summary:           jest.fn().mockResolvedValue({ totalStations: 0, passing: 0, needsImprovement: 0, failing: 0, passRate: 0 }),
  getPendingReviews: jest.fn().mockResolvedValue([]),
}

describe('StationsController › GET route role guards', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StationsController],
      providers: [
        { provide: StationsService, useValue: mockStationsService },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue(undefined) } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .compile()

    app = module.createNestApplication()
    await app.init()
  })

  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  // ── GET /stations ──────────────────────────────────────────────────────────

  describe('GET /stations', () => {
    const url = '/stations'

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✓ Passes in both states
    it('allows AUDITOR (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(200))

    // ✗ FAILS with current code — no role check, KIOSK gets 200
    it('blocks unknown role KIOSK (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'KIOSK').expect(403))
  })

  // ── GET /stations/filters ──────────────────────────────────────────────────

  describe('GET /stations/filters', () => {
    const url = '/stations/filters'

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✓ Passes in both states
    it('allows AUDITOR (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(200))

    // ✗ FAILS with current code — no role check, KIOSK gets 200
    it('blocks unknown role KIOSK (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'KIOSK').expect(403))
  })

  // ── GET /stations/:id ──────────────────────────────────────────────────────

  describe('GET /stations/:id', () => {
    const url = `/stations/${STATION_ID}`

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✓ Passes in both states
    it('allows AUDITOR (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(200))

    // ✗ FAILS with current code — no role check, KIOSK gets 200
    it('blocks unknown role KIOSK (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'KIOSK').expect(403))
  })

  // ── GET /stations/summary ──────────────────────────────────────────────────

  describe('GET /stations/summary', () => {
    const url = '/stations/summary'

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✗ FAILS with current code — no role check, AUDITOR gets 200
    it('blocks AUDITOR (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(403))
  })

  // ── GET /stations/pending-reviews ──────────────────────────────────────────

  describe('GET /stations/pending-reviews', () => {
    const url = '/stations/pending-reviews'

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✗ FAILS with current code — no role check, EXECUTIVE gets 200
    it('blocks EXECUTIVE (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(403))

    // ✗ FAILS with current code — no role check, AUDITOR gets 200
    it('blocks AUDITOR (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(403))
  })
})

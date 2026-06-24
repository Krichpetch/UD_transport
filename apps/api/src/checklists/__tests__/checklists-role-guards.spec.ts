/**
 * Role guard integration tests — checklists.controller.ts (GET routes)
 *
 * Both GET routes currently have no role restriction beyond JwtAuthGuard.
 * CLAUDE.md rule: "All API endpoints must be role-guarded (ADMIN / AUDITOR / EXECUTIVE)"
 *
 * GET /stations/:id/checklist         → ADMIN, AUDITOR, EXECUTIVE (explicit; KIOSK → 403)
 * GET /stations/:id/checklist/history → ADMIN, AUDITOR, EXECUTIVE (explicit; KIOSK → 403)
 *
 * Tests marked ✗ FAIL with current code.
 * Tests marked ✓ pass in both states.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import request = require('supertest')
import { ChecklistsController } from '../checklists.controller'
import { ChecklistsService } from '../checklists.service'
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

const mockChecklistsService = {
  findLatest: jest.fn().mockResolvedValue(null),
  findAll:    jest.fn().mockResolvedValue([]),
}

describe('ChecklistsController › GET route role guards', () => {
  let app: INestApplication

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChecklistsController],
      providers: [
        { provide: ChecklistsService, useValue: mockChecklistsService },
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

  // ── GET /stations/:id/checklist ────────────────────────────────────────────

  describe('GET /stations/:id/checklist', () => {
    const url = `/stations/${STATION_ID}/checklist`

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows AUDITOR (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✗ FAILS with current code — no role check, KIOSK gets 200
    it('blocks unknown role KIOSK (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'KIOSK').expect(403))
  })

  // ── GET /stations/:id/checklist/history ────────────────────────────────────

  describe('GET /stations/:id/checklist/history', () => {
    const url = `/stations/${STATION_ID}/checklist/history`

    // ✓ Passes in both states
    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    // ✓ Passes in both states
    it('allows AUDITOR (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(200))

    // ✓ Passes in both states
    it('allows EXECUTIVE (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(200))

    // ✗ FAILS with current code — no role check, KIOSK gets 200
    it('blocks unknown role KIOSK (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'KIOSK').expect(403))
  })
})

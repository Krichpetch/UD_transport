/**
 * Role guard integration tests — checklists.controller.ts
 *
 * Bug (line 34): POST .../submit — no role check
 * Bug (line 25): POST .../draft  — no role check
 *
 * Expected (correct): EXECUTIVE → 403, ADMIN → 403, AUDITOR → 201
 * Current  (buggy):   all roles  → 201  ← BUG
 *
 * The four EXECUTIVE/ADMIN tests FAIL with current code.
 * The two AUDITOR tests pass in both states.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import request = require('supertest')
import { ChecklistsController } from '../checklists.controller'
import { ChecklistsService } from '../checklists.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const STATION_ID = 'station-test-id'
const ITEMS = { A1: { value: 'มี', meetsStandard: true } }

// Replaces JwtAuthGuard entirely — reads role from x-test-role header and
// injects req.user in the shape JwtStrategy.validate() would produce from
// a real JWT payload { sub, role }.
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
  saveDraft: jest.fn().mockResolvedValue({ id: 'draft-id', status: 'DRAFT' }),
  submit:    jest.fn().mockResolvedValue({ id: 'cl-id',    status: 'SUBMITTED' }),
}

describe('ChecklistsController › role guards', () => {
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

  // ── POST .../submit ──────────────────────────────────────────────────────

  describe('POST /stations/:stationId/checklist/submit', () => {
    const url = `/stations/${STATION_ID}/checklist/submit`

    // ✗ FAILS with current code — no role check, controller returns 201
    it('blocks EXECUTIVE (expects 403)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'EXECUTIVE').send({ items: ITEMS })
        .expect(403))

    // ✗ FAILS with current code — no role check, controller returns 201
    it('blocks ADMIN (expects 403)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'ADMIN').send({ items: ITEMS })
        .expect(403))

    // ✓ Passes in both states — baseline
    it('allows AUDITOR (expects 201)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'AUDITOR').send({ items: ITEMS })
        .expect(201))
  })

  // ── POST .../draft ───────────────────────────────────────────────────────

  describe('POST /stations/:stationId/checklist/draft', () => {
    const url = `/stations/${STATION_ID}/checklist/draft`

    // ✗ FAILS with current code — no role check, controller returns 201
    it('blocks EXECUTIVE (expects 403)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'EXECUTIVE').send({ items: ITEMS })
        .expect(403))

    // ✗ FAILS with current code — no role check, controller returns 201
    it('blocks ADMIN (expects 403)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'ADMIN').send({ items: ITEMS })
        .expect(403))

    // ✓ Passes in both states — baseline
    it('allows AUDITOR (expects 201)', () =>
      request(app.getHttpServer())
        .post(url).set('x-test-role', 'AUDITOR').send({ items: ITEMS })
        .expect(201))
  })
})

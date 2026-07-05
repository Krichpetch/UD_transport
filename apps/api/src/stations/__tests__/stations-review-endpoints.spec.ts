/**
 * Role guard + BOLA tests for the Phase 2 review workflow endpoints:
 *   POST  /stations/:id/checklist/:checklistId/reject
 *   PATCH /stations/:id/checklist/:checklistId/items/:itemId/flag
 *   GET   /stations?checklistStatus=...
 *
 * All three are ADMIN-only — reject/flag are review actions, and checklistStatus
 * exposes the approval queue (who submitted what, admin notes on rejection).
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
import request = require('supertest')
import { StationsController } from '../stations.controller'
import { StationsService } from '../stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const STATION_ID = 'station-test-id'
const CHECKLIST_ID = 'checklist-test-id'
const ITEM_ID = 'A1.1'

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
  findAll: jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 0 }),
  rejectChecklist: jest.fn().mockResolvedValue({ id: CHECKLIST_ID, status: 'REJECTED' }),
  setItemFlag: jest.fn().mockResolvedValue({
    checklist: { id: CHECKLIST_ID }, before: false, after: true,
  }),
}

describe('StationsController › review workflow role guards', () => {
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

  describe('POST /stations/:id/checklist/:checklistId/reject', () => {
    const url = `/stations/${STATION_ID}/checklist/${CHECKLIST_ID}/reject`

    it('allows ADMIN with notes (expects 201)', () =>
      request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send({ notes: 'แก้ไขทางลาด' }).expect(201))

    it('blocks EXECUTIVE (expects 403)', () =>
      request(app.getHttpServer()).post(url).set('x-test-role', 'EXECUTIVE').send({ notes: 'x' }).expect(403))

    it('blocks AUDITOR (expects 403)', () =>
      request(app.getHttpServer()).post(url).set('x-test-role', 'AUDITOR').send({ notes: 'x' }).expect(403))

    it('rejects ADMIN with empty notes (expects 400)', () =>
      request(app.getHttpServer()).post(url).set('x-test-role', 'ADMIN').send({ notes: '  ' }).expect(400))
  })

  describe('PATCH /stations/:id/checklist/:checklistId/items/:itemId/flag', () => {
    const url = `/stations/${STATION_ID}/checklist/${CHECKLIST_ID}/items/${ITEM_ID}/flag`

    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).patch(url).set('x-test-role', 'ADMIN').send({ reviewFlag: true }).expect(200))

    it('blocks EXECUTIVE (expects 403)', () =>
      request(app.getHttpServer()).patch(url).set('x-test-role', 'EXECUTIVE').send({ reviewFlag: true }).expect(403))

    it('blocks AUDITOR (expects 403)', () =>
      request(app.getHttpServer()).patch(url).set('x-test-role', 'AUDITOR').send({ reviewFlag: true }).expect(403))
  })

  describe('GET /stations?checklistStatus=SUBMITTED', () => {
    const url = '/stations?checklistStatus=SUBMITTED'

    it('allows ADMIN (expects 200)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'ADMIN').expect(200))

    it('blocks EXECUTIVE from the approval queue (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'EXECUTIVE').expect(403))

    it('blocks AUDITOR from the approval queue (expects 403)', () =>
      request(app.getHttpServer()).get(url).set('x-test-role', 'AUDITOR').expect(403))

    it('still allows AUDITOR on the plain (unfiltered) list (expects 200)', () =>
      request(app.getHttpServer()).get('/stations').set('x-test-role', 'AUDITOR').expect(200))
  })
})

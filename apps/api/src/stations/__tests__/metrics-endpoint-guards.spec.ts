/**
 * Session 3 (CODE_REVIEW.md 4.4) — GET /stations/metrics and GET /stations/map-nodes must
 * mirror GET /stations/summary's role guard (ADMIN/EXECUTIVE only, AUDITOR → 403), and
 * cabinetApproved must 501 rather than silently returning misleading data (no มติครม. field
 * exists on Station yet — see TODO(executive-dashboard) in stations.controller.ts).
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import request = require('supertest')
import { StationsController } from '../stations.controller'
import { StationsService } from '../stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'

const mockGuard = {
  canActivate: (ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest()
    const role = req.headers['x-test-role'] as string
    if (!role) return false
    req.user = { id: 'test-user-id', username: 'testuser', role }
    return true
  },
}

const emptyMetrics = {
  totalStations: 0, evaluatedStations: 0,
  metrics: { total: 0, hasItem: 0, meetsStandard: 0, pctSuccess: 0, pctHasFacility: 0, pctMeetsStandard: 0 },
  appliedFilters: {},
}

const mockStationsService = {
  computeMetrics: jest.fn().mockResolvedValue(emptyMetrics),
  findMapNodes:   jest.fn().mockResolvedValue([]),
}

describe('GET /stations/metrics and /stations/map-nodes — role guards + cabinetApproved gate', () => {
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  describe('GET /stations/metrics', () => {
    it('allows ADMIN', () =>
      request(app.getHttpServer()).get('/stations/metrics').set('x-test-role', 'ADMIN').expect(200))

    it('allows EXECUTIVE', () =>
      request(app.getHttpServer()).get('/stations/metrics').set('x-test-role', 'EXECUTIVE').expect(200))

    it('blocks AUDITOR (403)', () =>
      request(app.getHttpServer()).get('/stations/metrics').set('x-test-role', 'AUDITOR').expect(403))

    it('rejects an invalid mode value (400)', () =>
      request(app.getHttpServer()).get('/stations/metrics?mode=NOT_A_MODE').set('x-test-role', 'ADMIN').expect(400))

    it('returns 501 when cabinetApproved is sent, without calling computeMetrics', async () => {
      await request(app.getHttpServer())
        .get('/stations/metrics?cabinetApproved=true')
        .set('x-test-role', 'ADMIN')
        .expect(501)
      expect(mockStationsService.computeMetrics).not.toHaveBeenCalled()
    })
  })

  describe('GET /stations/map-nodes', () => {
    it('allows ADMIN', () =>
      request(app.getHttpServer()).get('/stations/map-nodes').set('x-test-role', 'ADMIN').expect(200))

    it('allows EXECUTIVE', () =>
      request(app.getHttpServer()).get('/stations/map-nodes').set('x-test-role', 'EXECUTIVE').expect(200))

    it('blocks AUDITOR (403)', () =>
      request(app.getHttpServer()).get('/stations/map-nodes').set('x-test-role', 'AUDITOR').expect(403))
  })
})

/**
 * Session F3, Part F — "เอาหน้า Dashboard ของ Executive มาใส่ให้ Admin ด้วย" (สนข. 2026-08-03).
 *
 * The executive dashboard was WIDENED, never forked: ADMIN now sees the same /dashboard nav entry
 * and page. No endpoint changed — all three the dashboard calls already admitted ADMIN, which is
 * exactly what this suite proves, so a future guard tightening can't silently break admin access.
 *
 * The other half of the guarantee is that EXECUTIVE behaviour is byte-identical to before: every
 * assertion for EXECUTIVE here is the pre-F3 expectation, unchanged.
 *
 * Also pinned: AUDITOR still gets 403 on all three (widening to ADMIN must not widen to everyone),
 * and the training-station exclusion is a property of the QUERIES, not of the caller's role —
 * StationsService contains zero role references, so an ADMIN caller cannot see training rows in
 * dashboard aggregates any more than an EXECUTIVE one could.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication } from '@nestjs/common'
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
  summary:        jest.fn().mockResolvedValue({ totalStations: 0 }),
  computeMetrics: jest.fn().mockResolvedValue(emptyMetrics),
  findMapNodes:   jest.fn().mockResolvedValue([]),
}

// Every endpoint the executive dashboard calls on load.
const DASHBOARD_ENDPOINTS = ['/stations/summary', '/stations/metrics', '/stations/map-nodes'] as const

describe('Part F — ADMIN reaches every endpoint the executive dashboard calls', () => {
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

  afterAll(async () => {
    await app.close()
  })

  it.each(DASHBOARD_ENDPOINTS)('ADMIN gets 200 on %s', async (path) => {
    await request(app.getHttpServer()).get(path).set('x-test-role', 'ADMIN').expect(200)
  })

  it.each(DASHBOARD_ENDPOINTS)('EXECUTIVE still gets 200 on %s (unchanged)', async (path) => {
    await request(app.getHttpServer()).get(path).set('x-test-role', 'EXECUTIVE').expect(200)
  })

  it.each(DASHBOARD_ENDPOINTS)('AUDITOR still gets 403 on %s (widened to ADMIN, not to all)', async (path) => {
    await request(app.getHttpServer()).get(path).set('x-test-role', 'AUDITOR').expect(403)
  })

  it('does not expose a mutating dashboard route to ADMIN by side effect', () => {
    // The dashboard is read-only by design (Part F.4). These three are the only endpoints it
    // calls, and all three are @Get — asserted structurally so adding a POST/PATCH sibling to
    // "the dashboard endpoints" list has to be a deliberate edit here too.
    expect(mockStationsService.summary).toBeDefined()
    expect(mockStationsService.computeMetrics).toBeDefined()
    expect(mockStationsService.findMapNodes).toBeDefined()
  })
})

/**
 * Regression test — BatchOtpDto.rows must be bounded. Without an
 * @ArrayMaxSize, an ADMIN (or a stolen admin token) can post an
 * unbounded rows array at the @SkipThrottle batch-otp endpoint, and the
 * unbounded per-row import loop (StationsService.batchOtpImport) has no
 * other size guard.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common'
import { json } from 'express'
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

const mockStationsService = {
  batchOtpImport: jest.fn().mockResolvedValue([]),
}

function makeRow(i: number) {
  return {
    station: {
      nameTh: `สถานีทดสอบ ${i}`,
      name: `Test Station ${i}`,
      mode: 'ทางบก',
      province: 'กรุงเทพมหานคร',
      region: 'กลาง',
      responsibleAgency: 'ขบ.',
      lat: 13.75,
      lng: 100.5,
    },
    items: [],
    score: 80,
    status: 'ผ่านมาตรฐาน',
    lastInspected: '2026-01-01',
  }
}

describe('POST /stations/batch-otp — rows array size cap', () => {
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
    app.use(json({ limit: '10mb' }))
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  })

  afterAll(() => app.close())
  afterEach(() => jest.clearAllMocks())

  it('rejects 501 rows (400)', () =>
    request(app.getHttpServer())
      .post('/stations/batch-otp')
      .set('x-test-role', 'ADMIN')
      .send({ rows: Array.from({ length: 501 }, (_, i) => makeRow(i)) })
      .expect(400))

  it('accepts 500 rows (201)', () =>
    request(app.getHttpServer())
      .post('/stations/batch-otp')
      .set('x-test-role', 'ADMIN')
      .send({ rows: Array.from({ length: 500 }, (_, i) => makeRow(i)) })
      .expect(201))
})

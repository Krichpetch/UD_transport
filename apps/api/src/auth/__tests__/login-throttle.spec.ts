/**
 * Regression test — login rate limit must enforce 10 req/60 s.
 *
 * Currently FAILS: @Throttle({ default: { ttl: 60000, limit: 10 } }) on
 * POST /auth/login is a no-op because ThrottlerGuard is not registered as
 * APP_GUARD in AppModule. All 11 requests return 201.
 *
 * Fix (makes this pass):
 *   // apps/api/src/app.module.ts
 *   import { APP_GUARD } from '@nestjs/core'
 *   import { ThrottlerGuard } from '@nestjs/throttler'
 *   providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
 */

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request = require('supertest')
import { AppModule } from '../../app.module'
import { AuthService } from '../auth.service'
import { PrismaService } from '../../prisma/prisma.service'

describe('POST /auth/login — rate limiting', () => {
  let app: INestApplication

  beforeAll(async () => {
    // Must be set before compile() — JwtStrategy reads JWT_SECRET in its constructor.
    // Note: JwtModule.register() already ran with secret:undefined at import time,
    // but AuthService is mocked so JwtService.sign() is never called — harmless.
    process.env.JWT_SECRET       ??= 'test-secret-throttle-spec'
    process.env.DATABASE_URL     ??= 'postgresql://fake:fake@localhost:5432/fake'
    process.env.MINIO_ACCESS_KEY ??= 'fake-access-key'
    process.env.MINIO_SECRET_KEY ??= 'fake-secret-key'
    process.env.FRONTEND_URL     ??= 'http://localhost:3000'

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(AuthService)
      .useValue({
        login: jest.fn().mockResolvedValue({
          access_token: 'fake-jwt',
          user: { id: 'u1', username: 'admin', role: 'ADMIN' },
        }),
      })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  }, 30_000)

  afterAll(async () => {
    await app.close()
  })

  it('blocks the 11th login attempt within the 60 s window with 429', async () => {
    const server = app.getHttpServer()
    const body = { username: 'admin', password: 'password123' }

    for (let i = 1; i <= 10; i++) {
      const res = await request(server).post('/auth/login').send(body)
      expect(res.status).toBe(201)
    }

    const blocked = await request(server).post('/auth/login').send(body)
    expect(blocked.status).toBe(429)
  })
})

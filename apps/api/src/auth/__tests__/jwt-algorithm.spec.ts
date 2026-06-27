/**
 * Security regression test — algorithm confusion attack (alg:none).
 *
 * A JWT with {"alg":"none"} carries no signature — any payload can be forged
 * without knowing the secret. JwtStrategy must reject it at the verification
 * stage (before validate() is ever called).
 *
 * jsonwebtoken v9+ rejects alg:none by default when a string secret is used,
 * but the safe path is to pin algorithms: ['HS256'] in JwtStrategy so the
 * protection is explicit and not reliant on a library default.
 *
 * The second test case returns a real matching user from PrismaService so the
 * ONLY barrier is the cryptographic check — if that test passes, the token was
 * rejected before validate() was reached.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request = require('supertest')
import { AppModule } from '../../app.module'
import { MinioService } from '../../minio/minio.service'
import { PrismaService } from '../../prisma/prisma.service'

function base64url(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
}

function forgeNoneAlgToken(payload: object): string {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  const body   = base64url(JSON.stringify(payload))
  return `${header}.${body}.` // empty signature segment
}

const mockFindUnique = jest.fn()

const FAKE_ADMIN_USER = {
  id:        'attacker',
  username:  'attacker',
  email:     'attacker@example.com',
  role:      'ADMIN',
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('JwtAuthGuard › algorithm confusion (alg:none)', () => {
  let app: INestApplication

  beforeAll(async () => {
    process.env.JWT_SECRET            ??= 'test-secret-alg-spec-long-enough'
    process.env.DATABASE_URL          ??= 'postgresql://fake:fake@localhost:5432/fake'
    process.env.MINIO_ACCESS_KEY      ??= 'fake-access-key'
    process.env.MINIO_SECRET_KEY      ??= 'fake-secret-key'
    process.env.MINIO_PUBLIC_ENDPOINT ??= 'http://localhost:9000'
    process.env.FRONTEND_URL          ??= 'http://localhost:3000'

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ user: { findUnique: mockFindUnique } })
      .overrideProvider(MinioService)
      .useValue({ getPresignedUrl: jest.fn() })
      .compile()

    app = moduleRef.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))
    await app.init()
  }, 30_000)

  afterAll(async () => { await app.close() })

  it('rejects alg:none token — user not found (401 via missing user)', async () => {
    mockFindUnique.mockResolvedValue(null)
    const token = forgeNoneAlgToken({
      sub:  'attacker',
      role: 'ADMIN',
      iat:  Math.floor(Date.now() / 1000),
    })

    const res = await request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'checklist-photos/forged.jpg' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('rejects alg:none token — user EXISTS (401 proves cryptographic-layer rejection)', async () => {
    mockFindUnique.mockResolvedValue(FAKE_ADMIN_USER)
    const token = forgeNoneAlgToken({
      sub:  'attacker',
      role: 'ADMIN',
      iat:  Math.floor(Date.now() / 1000),
    })

    const res = await request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'checklist-photos/forged.jpg' })
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })
})

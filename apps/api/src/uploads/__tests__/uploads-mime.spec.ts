/**
 * Security regression test — MIME type allowlist on POST /uploads/photo.
 *
 * Accepting arbitrary file types (text/html, application/javascript) via a
 * photo upload endpoint creates a stored-XSS / malware hosting vector.
 * The endpoint must only allow image/* (and optionally application/pdf).
 *
 * text/html and application/javascript cases FAIL with current code —
 * the controller passes every file straight to MinIO with no type check.
 */

import { CanActivate, ExecutionContext, INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request = require('supertest')
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { MinioService } from '../../minio/minio.service'
import { UploadsController } from '../uploads.controller'

class AuditorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    ctx.switchToHttp().getRequest().user = { id: 'auditor-1', username: 'auditor', role: 'AUDITOR' }
    return true
  }
}

describe('POST /uploads/photo › MIME type validation', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        {
          provide: MinioService,
          useValue: {
            upload:          jest.fn().mockResolvedValue('checklist-photos/test.jpg'),
            getPresignedUrl: jest.fn().mockResolvedValue('http://localhost:9000/bucket/test.jpg?sig=abc'),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuditorGuard)
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  }, 15_000)

  afterAll(async () => { await app.close() })

  it('accepts image/jpeg — 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.from('fake-jpeg-bytes'), {
        filename:    'photo.jpg',
        contentType: 'image/jpeg',
      })
    expect(res.status).toBe(201)
  })

  it('rejects text/html — 400 BadRequest', async () => {
    const res = await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename:    'evil.html',
        contentType: 'text/html',
      })
    expect(res.status).toBe(400)
  })

  it('rejects application/javascript — 400 BadRequest', async () => {
    const res = await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.from('console.log("pwned")'), {
        filename:    'evil.js',
        contentType: 'application/javascript',
      })
    expect(res.status).toBe(400)
  })
})

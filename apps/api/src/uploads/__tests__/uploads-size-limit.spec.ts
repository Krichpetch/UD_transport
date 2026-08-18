/**
 * Part D (auditor self-unsubmit/summary session) — server-side max-accepted-size backstop on
 * POST /uploads/photo. Client-side compression (apps/web/lib/image-compression.ts) targets
 * ~1-2MB before a photo is ever sent, but client trust was never the gate: this proves the
 * server itself still refuses an oversized upload regardless of what the client claims to have
 * compressed — the FileInterceptor's existing `limits: { fileSize: 10 * 1024 * 1024 }` (already
 * in uploads.controller.ts, not new for this session), confirmed here rather than only assumed.
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

describe('POST /uploads/photo › server-side size backstop', () => {
  let app: INestApplication
  const upload = jest.fn().mockResolvedValue('checklist-photos/test.jpg')

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        {
          provide: MinioService,
          useValue: {
            upload,
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

  it('accepts a file comfortably under the 10MB limit — never reaches MinIO.upload with a rejected request', async () => {
    upload.mockClear()
    const res = await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.alloc(2 * 1024 * 1024, 1), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBe(201)
    expect(upload).toHaveBeenCalledTimes(1)
  })

  it('rejects a file over the 10MB limit before it ever reaches MinIO — client-side compression is never the only gate', async () => {
    upload.mockClear()
    const res = await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.alloc(11 * 1024 * 1024, 1), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
    expect(upload).not.toHaveBeenCalled()
  })
})

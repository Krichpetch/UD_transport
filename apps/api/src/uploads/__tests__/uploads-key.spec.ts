/**
 * Security regression test — unpredictable MinIO object keys.
 *
 * Current key: `checklist-photos/${Date.now()}-${user.id}.<ext>`
 * Both components are guessable: timestamp is public, user.id is in the JWT.
 * Fix: replace with 16 random bytes rendered as 32 hex chars.
 *
 * All assertions FAIL with current code:
 *   - pattern fails  (key is not 32 hex chars)
 *   - user-id check fails (key contains 'auditor-1')
 *   - timestamp check fails (key contains 13-digit epoch ms)
 *   - uniqueness may fail (same ms + same user → same key)
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

const mockUpload = jest.fn().mockResolvedValue(undefined)

describe('POST /uploads/photo › object key unpredictability', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        {
          provide: MinioService,
          useValue: {
            upload:          mockUpload,
            getPresignedUrl: jest.fn().mockResolvedValue('http://localhost:9000/bucket/key?sig=abc'),
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

  async function uploadJpeg(): Promise<string> {
    mockUpload.mockClear()
    await request(app.getHttpServer())
      .post('/uploads/photo')
      .attach('file', Buffer.from('fake-jpeg-bytes'), { filename: 'photo.jpg', contentType: 'image/jpeg' })
    // upload(buffer, key, mimetype) — key is argument index 1
    return mockUpload.mock.calls[0][1] as string
  }

  it('key matches checklist-photos/[0-9a-f]{32}.jpg and contains no user id or timestamp', async () => {
    const key = await uploadJpeg()
    expect(key).toMatch(/^checklist-photos\/[0-9a-f]{32}\.jpg$/)
    expect(key).not.toContain('auditor-1')   // no user id
    expect(key).not.toMatch(/\d{10,}/)        // no epoch-ms timestamp
  })

  it('two consecutive uploads produce different keys', async () => {
    const key1 = await uploadJpeg()
    const key2 = await uploadJpeg()
    expect(key1).not.toBe(key2)
  })
})

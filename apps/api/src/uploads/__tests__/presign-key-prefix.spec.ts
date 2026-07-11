/**
 * Regression test — GET /uploads/presign must only mint presigned URLs for
 * objects under checklist-photos/. Without this, any authenticated user
 * could request a presigned URL for an arbitrary key anywhere in the
 * bucket. '../' and URL-encoded traversal must not be able to escape the
 * prefix check.
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

const getPresignedUrl = jest.fn().mockResolvedValue('http://localhost:9000/bucket/checklist-photos/abc.jpg?sig=abc')

describe('GET /uploads/presign — key prefix guard', () => {
  let app: INestApplication

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UploadsController],
      providers: [
        { provide: MinioService, useValue: { getPresignedUrl } },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(AuditorGuard)
      .compile()

    app = moduleRef.createNestApplication()
    await app.init()
  })

  afterAll(async () => { await app.close() })
  afterEach(() => jest.clearAllMocks())

  it('allows a key under checklist-photos/ (200)', () =>
    request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'checklist-photos/abc123.jpg' })
      .expect(200))

  it('rejects a key outside checklist-photos/ (400)', () =>
    request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'other-bucket-dir/secret.jpg' })
      .expect(400))

  it('rejects plain ../ traversal that escapes the prefix (400)', () =>
    request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'checklist-photos/../secret.jpg' })
      .expect(400))

  it('rejects URL-encoded traversal that escapes the prefix (400)', () =>
    request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'checklist-photos/%2e%2e/secret.jpg' })
      .expect(400))

  it('rejects a key with no prefix at all (400)', () =>
    request(app.getHttpServer())
      .get('/uploads/presign')
      .query({ key: 'secret.jpg' })
      .expect(400))
})

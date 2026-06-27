/**
 * Regression test — getPresignedUrl() must use the PUBLIC MinIO client
 * (constructed with MINIO_PUBLIC_ENDPOINT) when signing URLs, not the
 * internal client (constructed with MINIO_ENDPOINT).
 *
 * The mock captures each Client instance's constructor endPoint so the test
 * can assert the signed URL contains the public host ('localhost'), not the
 * internal Docker hostname ('minio').
 */

import { MinioService } from '../minio.service'

jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation((opts: { endPoint: string; port: number }) => ({
    presignedGetObject: jest.fn().mockResolvedValue(
      `http://${opts.endPoint}:${opts.port}/ud-transport/test-key?X-Amz-Signature=abc123`,
    ),
  })),
}))

describe('MinioService › getPresignedUrl public endpoint signing', () => {
  let service: MinioService
  let saved: Record<string, string | undefined> = {}

  const ENV = {
    MINIO_ENDPOINT:        'minio',
    MINIO_PORT:            '9000',
    MINIO_ACCESS_KEY:      'test-access',
    MINIO_SECRET_KEY:      'test-secret',
    MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
  }

  beforeEach(() => {
    for (const key of Object.keys(ENV)) {
      saved[key] = process.env[key]
      process.env[key] = ENV[key as keyof typeof ENV]
    }
    service = new MinioService()
    service.onModuleInit()
  })

  afterEach(() => {
    for (const key of Object.keys(ENV)) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key] as string
      } else {
        delete process.env[key]
      }
    }
    saved = {}
  })

  it('uses MINIO_PUBLIC_ENDPOINT hostname, not the internal MINIO_ENDPOINT', async () => {
    const url = await service.getPresignedUrl('test-key')
    const { hostname } = new URL(url)
    expect(hostname).toBe('localhost')
    expect(hostname).not.toBe('minio')
  })

  it('preserves path and query string from the presigned URL', async () => {
    const url = await service.getPresignedUrl('test-key')
    const parsed = new URL(url)
    expect(parsed.pathname).toBe('/ud-transport/test-key')
    expect(parsed.searchParams.get('X-Amz-Signature')).toBe('abc123')
  })

  it('uses the port from MINIO_PUBLIC_ENDPOINT', async () => {
    const url = await service.getPresignedUrl('test-key')
    expect(new URL(url).port).toBe('9000')
  })
})

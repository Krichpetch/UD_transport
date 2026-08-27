import { Injectable, OnModuleInit } from '@nestjs/common'
import * as Minio from 'minio'

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Minio.Client
  private publicClient: Minio.Client
  private bucket = process.env.MINIO_BUCKET ?? 'ud-transport'

  onModuleInit() {
    this.client = new Minio.Client({
      endPoint:  process.env.MINIO_ENDPOINT  ?? 'localhost',
      port:      Number(process.env.MINIO_PORT ?? 9000),
      useSSL:    process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    })
    const pub = new URL(process.env.MINIO_PUBLIC_ENDPOINT!)
    this.publicClient = new Minio.Client({
      endPoint:  pub.hostname,
      port:      pub.port ? Number(pub.port) : pub.protocol === 'https:' ? 443 : 80,
      useSSL:    pub.protocol === 'https:',
      accessKey: process.env.MINIO_ACCESS_KEY!,
      secretKey: process.env.MINIO_SECRET_KEY!,
    })
  }

  // `metadata` — optional extra object metadata merged alongside Content-Type (e.g. the
  // `X-Amz-Meta-Compressed` idempotency marker the image compressor sets; see
  // uploads/image-compression.ts). Defaults to none, so existing callers are unaffected.
  async upload(buffer: Buffer, key: string, mimetype: string, metadata: Record<string, string> = {}): Promise<string> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': mimetype, ...metadata })
    return key
  }

  async getPresignedUrl(key: string, expirySeconds = 3600): Promise<string> {
    return this.publicClient.presignedGetObject(this.bucket, key, expirySeconds)
  }

  // Session E3, Part C.3 — auditor-initiated photo deletion (wrong-evidence case). Removes the
  // object from the bucket; callers are responsible for also stripping the ChecklistPhoto entry
  // from the stored items JSON and audit-logging the deletion.
  async remove(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key)
  }
}

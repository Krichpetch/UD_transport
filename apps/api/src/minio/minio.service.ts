import { Injectable, OnModuleInit } from '@nestjs/common'
import * as Minio from 'minio'

@Injectable()
export class MinioService implements OnModuleInit {
  private client: Minio.Client
  private bucket = process.env.MINIO_BUCKET ?? 'ud-transport'

  onModuleInit() {
    this.client = new Minio.Client({
      endPoint:  process.env.MINIO_ENDPOINT  ?? 'localhost',
      port:      Number(process.env.MINIO_PORT ?? 9000),
      useSSL:    false,
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'admin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'password',
    })
  }

  async upload(buffer: Buffer, key: string, mimetype: string): Promise<string> {
    await this.client.putObject(this.bucket, key, buffer, buffer.length, { 'Content-Type': mimetype })
    const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost'
    const port     = process.env.MINIO_PORT     ?? '9000'
    return `http://${endpoint}:${port}/${this.bucket}/${key}`
  }
}

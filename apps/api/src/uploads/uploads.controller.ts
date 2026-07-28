import { randomBytes } from 'crypto'
import { posix } from 'path'
import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { MinioService } from '../minio/minio.service'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
// W2-S3a Part D added 'template-images/' (admin template reference photos, see
// admin/templates/templates.service.ts) alongside the original auditor evidence-photo prefix —
// widened to an allowlist array here rather than loosening the check to any single broader rule,
// so a third future prefix is one more array entry, not a rewrite of the guard's logic.
const PRESIGN_KEY_PREFIXES = ['checklist-photos/', 'template-images/']

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly minio: MinioService) {}

  @Post('photo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadPhoto(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) throw new BadRequestException('Invalid file type')
    const ext = file.originalname.split('.').pop() ?? 'jpg'
    const key = `checklist-photos/${randomBytes(16).toString('hex')}.${ext}`
    await this.minio.upload(file.buffer, key, file.mimetype)
    const url = await this.minio.getPresignedUrl(key)
    return { id: key, url, filename: file.originalname, uploadedAt: new Date().toISOString() }
  }

  // Restricted to PRESIGN_KEY_PREFIXES so an authenticated user can't mint a presigned
  // URL for an arbitrary object elsewhere in the bucket. Decode + posix.normalize
  // before checking the prefix so '../' and its URL-encoded form can't escape it.
  @Get('presign')
  async presign(@Query('key') key: string) {
    if (!key) throw new BadRequestException('key is required')

    let decoded: string
    try {
      decoded = decodeURIComponent(key)
    } catch {
      throw new BadRequestException('Invalid key')
    }
    const normalized = posix.normalize(decoded)
    if (!PRESIGN_KEY_PREFIXES.some((prefix) => normalized.startsWith(prefix)) || normalized.includes('..')) {
      throw new BadRequestException('Invalid key')
    }

    return { url: await this.minio.getPresignedUrl(normalized) }
  }
}

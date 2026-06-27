import { randomBytes } from 'crypto'
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

  @Get('presign')
  async presign(@Query('key') key: string) {
    if (!key) throw new BadRequestException('key is required')
    return { url: await this.minio.getPresignedUrl(key) }
  }
}

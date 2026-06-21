import {
  Controller,
  ForbiddenException,
  Post,
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
    const ext = file.originalname.split('.').pop() ?? 'jpg'
    const key = `checklist-photos/${Date.now()}-${req.user.id}.${ext}`
    const url = await this.minio.upload(file.buffer, key, file.mimetype)
    return { id: key, url, filename: file.originalname, uploadedAt: new Date().toISOString() }
  }
}

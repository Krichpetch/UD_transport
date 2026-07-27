import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AdminService } from './admin.service'
import { ReimportService } from './reimport/reimport.service'
import { ReimportRowsDto } from './reimport/dto/reimport-rows.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly reimport: ReimportService,
  ) {}

  @Get('overview')
  overview(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.admin.getOverview()
  }

  // Part F (W2-S1) — dryRun:true (default false must be explicitly opted out of by the caller)
  // runs the full matching/scoring pipeline and returns the match report without writing
  // anything. The real historical export is never committed to this repo; this endpoint is
  // exercised in tests via the synthetic fixture, same tool either way.
  @Post('reimport/legacy-checklists')
  reimportLegacyChecklists(@Body() body: ReimportRowsDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.reimport.importRows(body.rows, req.user.id, body.dryRun ?? true)
  }
}

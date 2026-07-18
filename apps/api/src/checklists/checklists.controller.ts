import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ChecklistsService } from './checklists.service'
import { SaveDraftChecklistDto, SubmitChecklistDto } from './dto/submit-checklist.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

@Controller('stations/:stationId/checklist')
@UseGuards(JwtAuthGuard)
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get()
  findLatest(@Param('stationId') stationId: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'AUDITOR' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    return this.checklists.findLatest(stationId)
  }

  @Get('history')
  findAll(@Param('stationId') stationId: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'AUDITOR' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    return this.checklists.findAll(stationId)
  }

  @Get('draft')
  findDraft(@Param('stationId') stationId: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.findDraft(stationId, req.user.id)
  }

  @Post('draft')
  saveDraft(
    @Param('stationId') stationId: string,
    @Body() body: SaveDraftChecklistDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.saveDraft(stationId, req.user.id, body.items)
  }

  @Post('submit')
  submit(
    @Param('stationId') stationId: string,
    @Body() body: SubmitChecklistDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.submit(stationId, req.user.id, body.items, body.score, body.gps, body.finalThoughts)
  }
}

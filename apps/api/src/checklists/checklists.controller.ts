import { Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
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

  // E-form redesign (Session E2, Part A.6) — the ACTIVE template with byLaw values already
  // resolved (client never picks between eras). AUDITOR-only: this is keyed to "my" in-progress
  // draft's stamp when one exists, same guard as /draft above. `preview=v2` (Part B.2) is
  // additionally gated to ADMIN — a pilot AUDITOR can never fetch the un-activated v2 DRAFT
  // definition through this endpoint, regardless of what query string they send.
  @Get('template')
  findTemplateForAudit(
    @Param('stationId') stationId: string,
    @Query('preview') preview: string | undefined,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR' && req.user.role !== 'ADMIN') throw new ForbiddenException()
    const wantsV2Preview = preview === 'v2'
    if (wantsV2Preview && req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.checklists.getTemplateForAudit(stationId, req.user.id, wantsV2Preview)
  }

  @Post('draft')
  saveDraft(
    @Param('stationId') stationId: string,
    @Body() body: SaveDraftChecklistDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.saveDraft(stationId, req.user.id, body.items, body.finalThoughts)
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

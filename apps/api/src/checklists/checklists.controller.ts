import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common'
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

  // Session E3, Part C.3 — auditor removes a photo they uploaded (wrong-evidence case), while the
  // checklist is still DRAFT or REJECTED. `photoId` is the MinIO object key (contains a slash —
  // "checklist-photos/<hex>.<ext>" — so it travels as a query param, never a route segment, same
  // convention as GET /uploads/presign?key=).
  @Delete(':checklistId/items/:itemId/photo')
  deletePhoto(
    @Param('stationId') stationId: string,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
    @Query('photoId') photoId: string,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    if (!photoId) throw new BadRequestException('photoId is required')
    return this.checklists.deletePhoto(stationId, checklistId, req.user.id, itemId, photoId)
  }
}

// Session E3, Part B.1 — the auditor's own returned-work list, not scoped to any one station,
// so it lives in a sibling controller rather than under ChecklistsController's
// stations/:stationId/checklist prefix.
@Controller('checklists')
@UseGuards(JwtAuthGuard)
export class MyChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  // Cheap dedicated query for a persistent header badge — must stay light enough to call on
  // every page, never the full list (see ChecklistsService.countMyRejected's doc).
  @Get('rejected/count')
  count(@Req() req: AuthRequest) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.countMyRejected(req.user.id)
  }

  @Get('rejected')
  list(@Req() req: AuthRequest) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.findMyRejected(req.user.id)
  }
}

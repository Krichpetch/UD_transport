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

  // page/limit are optional — omitted (the resubmission marker, the stations-list approve
  // button's flag check), this returns the full unpaginated array exactly as before. Passed
  // (the admin station-detail History tab), it returns a { data, total, page, totalPages }
  // envelope instead, same shape StationsService.findAll already uses for the stations list.
  @Get('history')
  findAll(
    @Param('stationId') stationId: string,
    @Query('page') page: string | undefined,
    @Query('limit') limit: string | undefined,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'AUDITOR' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    if (page === undefined && limit === undefined) return this.checklists.findAll(stationId)
    const pageNum = page ? Math.max(1, parseInt(page, 10) || 1) : 1
    const limitNum = limit ? Math.min(Math.max(1, parseInt(limit, 10) || 20), 100) : 20
    return this.checklists.findAllPaginated(stationId, pageNum, limitNum)
  }

  @Get('draft')
  findDraft(@Param('stationId') stationId: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.checklists.findDraft(stationId, req.user.id)
  }

  // E-form redesign (Session E2, Part A.6) — the ACTIVE template with byLaw values already
  // resolved (client never picks between eras). AUDITOR-only: this is keyed to "my" in-progress
  // draft's stamp when one exists, same guard as /draft above. `preview=1` (Part B.2) and/or
  // `version=<n>` (Session E4, admin station-list preview button) are additionally gated to
  // ADMIN — a pilot AUDITOR can never fetch a preview or an un-activated DRAFT definition through
  // this endpoint, regardless of what query string they send.
  @Get('template')
  findTemplateForAudit(
    @Param('stationId') stationId: string,
    @Query('preview') preview: string | undefined,
    @Query('version') version: string | undefined,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'AUDITOR' && req.user.role !== 'ADMIN') throw new ForbiddenException()
    const wantsPreview = preview === '1' || version !== undefined
    if (wantsPreview && req.user.role !== 'ADMIN') throw new ForbiddenException()

    let versionOverride: number | undefined
    if (version !== undefined) {
      versionOverride = Number(version)
      if (!Number.isInteger(versionOverride) || versionOverride < 1) {
        throw new BadRequestException('version must be a positive integer')
      }
    }
    return this.checklists.getTemplateForAudit(stationId, req.user.id, wantsPreview, versionOverride)
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

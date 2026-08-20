import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { TemplatesAdminService } from './templates.service'
import { EditMeasurementDto } from './dto/edit-measurement.dto'
import { EditEraDto } from './dto/edit-era.dto'
import { EditGuidanceDto } from './dto/edit-guidance.dto'
import { SetQuestionTypeDto } from './dto/set-question-type.dto'
import { AddChildDto } from './dto/add-child.dto'
import { ReorderNodeDto } from './dto/reorder-node.dto'
import { EditLawRefsDto } from './dto/edit-law-refs.dto'
import { EditLabelDto } from './dto/edit-label.dto'
import { ActivateTemplateDto } from './dto/activate-template.dto'
import { EditHiddenDto } from './dto/edit-hidden.dto'
import { EditStandaloneDto } from './dto/edit-standalone.dto'
import { AttachMasterDto } from './dto/attach-master.dto'
import { EditLabelByLawDto } from './dto/edit-label-by-law.dto'
import { AddTopLevelItemDto } from './dto/add-top-level-item.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

// W2-S3a Part A — "จัดการแบบประเมิน", ADMIN-only. Same manual-role-check convention as every other
// controller in this codebase (no @Roles()/RolesGuard exists here — see admin.controller.ts).
// Only VALUE edits live here (thresholds, era overrides, guidance text, images) — there is
// deliberately no add/remove/reorder/label/code/answerType endpoint; that's Session S3b.
@Controller('admin/templates')
@UseGuards(JwtAuthGuard)
export class TemplatesAdminController {
  constructor(private readonly templates: TemplatesAdminService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.list()
  }

  // Must be registered before ':id' so 'review-queue' doesn't get swallowed as an :id value.
  @Get('review-queue')
  reviewQueue(@Query('mode') mode: string | undefined, @Query('variantKey') variantKey: string | undefined, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.reviewQueue({ mode, variantKey })
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.get(id)
  }

  @Get(':id/export')
  export(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.exportTemplate(id)
  }

  @Patch(':id/measurements/:nodeCode/:measurementKey')
  editMeasurement(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Param('measurementKey') measurementKey: string,
    @Body() body: EditMeasurementDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editMeasurement(id, nodeCode, measurementKey, body, req.user.id)
  }

  @Post(':id/measurements/:nodeCode/:measurementKey/confirm')
  confirmMeasurement(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Param('measurementKey') measurementKey: string,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.confirmMeasurement(id, nodeCode, measurementKey, req.user.id)
  }

  @Patch(':id/era/:nodeCode/:measurementKey')
  editEra(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Param('measurementKey') measurementKey: string,
    @Body() body: EditEraDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editEra(id, nodeCode, measurementKey, body, req.user.id)
  }

  // ---- Era-editor safety session, Part C — container-only labelByLaw editing (any status). ----

  @Patch(':id/nodes/:nodeCode/label-by-law')
  editLabelByLaw(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditLabelByLawDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editLabelByLaw(id, nodeCode, body, req.user.id)
  }

  @Patch(':id/guidance/:nodeCode')
  editGuidance(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditGuidanceDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editGuidance(id, nodeCode, body, req.user.id)
  }

  @Post(':id/images/:nodeCode')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  addImage(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.addImage(id, nodeCode, file, req.user.id)
  }

  @Delete(':id/images/:nodeCode')
  removeImage(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Query('key') key: string,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.removeImage(id, nodeCode, key, req.user.id)
  }

  // ---- Session S3b, Part C — structural editing (DRAFT-only; enforced in the service, not just
  // here — see TemplatesAdminService.applyStructuralEdit). ----

  @Post(':id/clone-to-draft')
  cloneToDraft(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.cloneToDraft(id, req.user.id)
  }

  // 2026-08-05 — DRAFT -> ACTIVE. Previously CLI-only (apps/api/prisma/activate-template.ts);
  // this is the same guardrails behind a real admin action (see templates.service.ts).
  @Post(':id/activate')
  activate(@Param('id') id: string, @Body() body: ActivateTemplateDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.activateTemplate(id, req.user.id, body.force ?? false)
  }

  // Read-only detail behind the activation dialog's "ดูแบบร่างที่ได้รับผลกระทบ" button — the
  // in-progress drafts on OTHER versions of this template's (mode, variantKey) that a switch would
  // leave unhydrated (same set the DRAFTS_AT_RISK guardrail counts).
  @Get(':id/drafts-at-risk')
  draftsAtRisk(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.getDraftsAtRisk(id)
  }

  @Patch(':id/nodes/:nodeCode/label')
  editLabel(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditLabelDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editLabel(id, nodeCode, body, req.user.id)
  }

  @Patch(':id/measurements/:nodeCode/:measurementKey/reorder')
  reorderMeasurement(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Param('measurementKey') measurementKey: string,
    @Body() body: ReorderNodeDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.reorderMeasurement(id, nodeCode, measurementKey, body, req.user.id)
  }

  @Patch(':id/nodes/:nodeCode/type')
  setQuestionType(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: SetQuestionTypeDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.setQuestionType(id, nodeCode, body, req.user.id)
  }

  // A NEW measurement threshold (Part C.3) — distinct from PATCH .../measurements/:nodeCode/:key
  // above (S3a, edits a threshold that already exists, still allowed on ACTIVE).
  @Post(':id/measurements/:nodeCode')
  addMeasurement(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditMeasurementDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.addMeasurement(id, nodeCode, body, req.user.id)
  }

  @Post(':id/nodes/:parentCode/children')
  addChild(
    @Param('id') id: string,
    @Param('parentCode') parentCode: string,
    @Body() body: AddChildDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.addChild(id, parentCode, body, req.user.id)
  }

  // A brand-new TOP-LEVEL item (a sibling directly under a GROUP, or under an existing node),
  // positioned relative to an anchor — the individual-editor sibling of the grouped editor's
  // add-and-place. Distinct from POST .../nodes/:parentCode/children above (which only ever
  // appends a CHILD under an already-selected existing node).
  @Post(':id/top-level-items')
  addTopLevelItem(
    @Param('id') id: string,
    @Body() body: AddTopLevelItemDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.addTopLevelItem(id, body, req.user.id)
  }

  @Patch(':id/nodes/:nodeCode/reorder')
  reorderNode(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: ReorderNodeDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.reorderNode(id, nodeCode, body, req.user.id)
  }

  @Delete(':id/nodes/:nodeCode')
  deleteNode(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.deleteNode(id, nodeCode, req.user.id)
  }

  // ---- Session S3b, Part D — lawRefs editing (DRAFT AND ACTIVE). ----

  @Patch(':id/nodes/:nodeCode/law-refs')
  editLawRefs(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditLawRefsDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editLawRefs(id, nodeCode, body, req.user.id)
  }

  // ---- Session S4a, Part C — hide/unhide a node (any status). ----

  @Patch(':id/nodes/:nodeCode/hidden')
  editHidden(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditHiddenDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editHidden(id, nodeCode, body, req.user.id)
  }

  // ---- Session S4b-fix, Fix 4 — detach/re-attach a leaf from the grouped editor's pooling. ----

  @Patch(':id/nodes/:nodeCode/standalone')
  editStandalone(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: EditStandaloneDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.editStandalone(id, nodeCode, body, req.user.id)
  }

  // ---- Session S5, Part C — detach/(re)attach a leaf from an explicit master criterion link. ----

  @Post(':id/nodes/:nodeCode/detach-master')
  detachMaster(@Param('id') id: string, @Param('nodeCode') nodeCode: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.detachMaster(id, nodeCode, req.user.id)
  }

  @Post(':id/nodes/:nodeCode/attach-master')
  attachMaster(
    @Param('id') id: string,
    @Param('nodeCode') nodeCode: string,
    @Body() body: AttachMasterDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.templates.attachMaster(id, nodeCode, body, req.user.id)
  }
}

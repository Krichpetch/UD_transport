import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { Request } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { FacilityGroupsService, type VersionScope } from './facility-groups.service'
import { GroupedEditDto } from './dto/grouped-edit.dto'
import { ResolveConflictDto } from './dto/resolve-conflict.dto'
import { AddAndPlaceDto } from './dto/add-and-place.dto'
import { AttachNodeToGroupDto } from './dto/attach-node-to-group.dto'
import { DeleteGroupDto } from './dto/delete-group.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

// Session S4b — the facility-grouped editor. Deliberately a SEPARATE base path from
// admin/templates/:id (TemplatesAdminController) rather than admin/templates/facility-groups —
// that controller's own review-queue route comment already flags the ":id" catch-all hazard for
// literal sibling segments; a fully distinct prefix sidesteps it rather than relying on
// controller-registration order. ADMIN-only, same manual role-check convention as every other
// controller here (no @Roles()/RolesGuard exists in this codebase).
//
// Part 5 — VersionScope query params. `?version=3` (no `scope`) is the grouped editor's real
// default and is unchanged from before this addition: `{kind:'exact', version:3}`.
// `?scope=active`/`?scope=all` are the comparison/analysis modes — see VersionScope's doc in
// facility-groups.service.ts for why they are not alternate defaults.
function parseScope(scopeRaw: string | undefined, versionRaw: string | undefined): VersionScope {
  if (scopeRaw === 'active') return { kind: 'active' }
  if (scopeRaw === 'all') return { kind: 'all' }
  const version = Number(versionRaw)
  if (!versionRaw || !Number.isInteger(version)) {
    throw new BadRequestException('version query param is required when scope is exact/omitted (e.g. ?version=3, or ?scope=active|all)')
  }
  return { kind: 'exact', version }
}

@Controller('admin/template-groups')
@UseGuards(JwtAuthGuard)
export class FacilityGroupsController {
  constructor(private readonly groups: FacilityGroupsService) {}

  @Get()
  getGroups(@Query('version') version: string | undefined, @Query('scope') scope: string | undefined, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.getGroups(parseScope(scope, version))
  }

  @Get('conflicts')
  getConflicts(@Query('version') version: string | undefined, @Query('scope') scope: string | undefined, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.getConflicts(parseScope(scope, version))
  }

  @Get('review-queue')
  getReviewQueue(@Query('version') version: string | undefined, @Query('scope') scope: string | undefined, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.getGroupedReviewQueue(parseScope(scope, version))
  }

  // UDT-60 — same canonical leaves as GET / (getGroups), re-bucketed by law code instead of by
  // facility container. Read-only: editing still goes through items/:itemId/propagate below.
  @Get('by-law')
  getGroupsByLaw(@Query('version') version: string | undefined, @Query('scope') scope: string | undefined, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.getGroupsByLaw(parseScope(scope, version))
  }

  // Upload-only (no nodeCode/version — see FacilityGroupsService#uploadImage's doc for why this
  // is a separate route from templates.controller.ts's per-node one). Front end calls this to get
  // a key, then propagates it via 'items/:itemId/propagate' below with field 'image'.
  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadImage(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.uploadImage(file)
  }

  @Post('items/:itemId/propagate')
  propagateItemEdit(
    @Param('itemId') itemId: string,
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Body() body: GroupedEditDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.propagateItemEdit(parseScope(scope, version), itemId, req.user.id, body)
  }

  @Post('items/:itemId/measurements/:measurementKey/confirm')
  confirmGroupedMeasurement(
    @Param('itemId') itemId: string,
    @Param('measurementKey') measurementKey: string,
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.confirmGroupedMeasurement(parseScope(scope, version), itemId, measurementKey, req.user.id)
  }

  // Era-editor safety session, Part E — move an unattached node onto a DIFFERENT existing group.
  @Post('items/:targetItemId/attach-node')
  attachNode(
    @Param('targetItemId') targetItemId: string,
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Body() body: AttachNodeToGroupDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.attachNodeToGroup(parseScope(scope, version), targetItemId, body.templateId, body.nodeCode, req.user.id)
  }

  @Post('items/:itemId/resolve-conflict')
  resolveConflict(
    @Param('itemId') itemId: string,
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Body() body: ResolveConflictDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.resolveConflict(parseScope(scope, version), itemId, req.user.id, body)
  }

  // Session S4b-fix, Fix 3 — add-and-place. Must be registered after 'items/:itemId/...' routes
  // above (it is — Nest matches literal segments before catch-alls, and 'add-and-place' can never
  // collide with an ':itemId' value since that's always a canonical-item id like "cg-3-item-5").
  @Post('add-and-place')
  addAndPlace(
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Body() body: AddAndPlaceDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.addAndPlace(parseScope(scope, version), body, req.user.id)
  }

  // Live feedback (2026-08-17) — delete-group, the symmetric counterpart to add-and-place. Same
  // route-ordering note applies ('delete-group' can never collide with an ':itemId' value).
  @Post('delete-group')
  deleteGroup(
    @Query('version') version: string | undefined,
    @Query('scope') scope: string | undefined,
    @Body() body: DeleteGroupDto,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.groups.deleteGroup(parseScope(scope, version), body, req.user.id)
  }
}

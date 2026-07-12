import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AuditLogService } from '../audit/audit.service'
import { StationsService } from './stations.service'
import { CreateStationDto } from './dto/create-station.dto'
import { UpdateStationDto } from './dto/update-station.dto'
import { BatchOtpDto } from './dto/otp-row.dto'
import { MetricsQueryDto } from './dto/metrics-query.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

@Controller('stations')
@UseGuards(JwtAuthGuard)
export class StationsController {
  constructor(
    private readonly stations: StationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get('summary')
  summary(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    return this.stations.summary()
  }

  // Must come before @Get(':id') to avoid route conflict.
  @Get('metrics')
  metrics(@Query() query: MetricsQueryDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    if (query.cabinetApproved !== undefined) {
      // TODO(executive-dashboard): wire when มติครม. field lands on Station.
      throw new NotImplementedException({
        code: 'CABINET_APPROVED_NOT_IMPLEMENTED',
        message: 'ยังไม่รองรับการกรองตามมติ ครม. ในขณะนี้',
      })
    }
    const { cabinetApproved: _cabinetApproved, ...filters } = query
    return this.stations.computeMetrics(filters)
  }

  // Must come before @Get(':id') to avoid route conflict.
  // Slim uncapped station list for the dashboard's map/table/filters — see
  // StationsService.findMapNodes for why this is exempt from findAll()'s 100-row cap.
  @Get('map-nodes')
  mapNodes(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE') throw new ForbiddenException()
    return this.stations.findMapNodes()
  }

  // Must come before @Get(':id') to avoid route conflict
  @Get('pending-reviews')
  pendingReviews(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.getPendingReviews()
  }

  // Must come before @Get(':id') to avoid route conflict.
  // Real assessment data for the Excel export — one row per (station, auditYear).
  @Get('export/checklists')
  exportChecklists(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.findAllForExport()
  }

  @Get('export/checklists/:stationId')
  exportStationChecklists(@Param('stationId') stationId: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.findAllForExport(stationId)
  }

  @Get()
  findAll(
    @Req() req: AuthRequest,
    @Query('mode')            mode?: string,
    @Query('region')          region?: string,
    @Query('agency')          responsibleAgency?: string,
    @Query('status')          status?: string,
    @Query('checklistStatus') checklistStatus?: string,
    @Query('search')          search?: string,
    @Query('page')            page?: string,
    @Query('limit')           limit?: string,
    @Query('sortBy')          sortBy?: string,
    @Query('sortOrder')       sortOrder?: string,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE' && req.user.role !== 'AUDITOR') throw new ForbiddenException()
    // The approval-state queue (SUBMITTED/REJECTED/APPROVED checklists) is an admin review tool.
    if (checklistStatus && req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.findAll({
      mode, region, responsibleAgency, status, checklistStatus, search,
      page:      page      ? parseInt(page,  10) : 1,
      limit:     limit     ? parseInt(limit, 10) : 20,
      sortBy,
      sortOrder: sortOrder === 'desc' ? 'desc' : 'asc',
    })
  }

  @Get('filters')
  getFilterOptions(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE' && req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.stations.getFilterOptions()
  }

  // Slim search for the auditor station picker — returns id/nameTh/province/mode only
  @Get('search')
  search(
    @Req() req: AuthRequest,
    @Query('q')     q?: string,
    @Query('mode')  mode?: string,
    @Query('limit') limit?: string,
    @Query('page')  page?: string,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE' && req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.stations.searchSlim({
      q,
      mode,
      limit: limit ? Math.min(parseInt(limit, 10), 50) : 20,
      page:  page  ? parseInt(page, 10) : 1,
    })
  }

  // Must come before @Get(':id') to avoid route conflict.
  // Location-first auditor picker + the check-in/submit proximity gate's "what's near me" view.
  @Get('nearby')
  nearby(
    @Req() req: AuthRequest,
    @Query('lat')   lat?: string,
    @Query('lng')   lng?: string,
    @Query('limit') limit?: string,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE' && req.user.role !== 'AUDITOR') throw new ForbiddenException()
    const latNum = lat ? parseFloat(lat) : NaN
    const lngNum = lng ? parseFloat(lng) : NaN
    if (isNaN(latNum) || isNaN(lngNum)) throw new BadRequestException('lat/lng required')
    return this.stations.findNearby(latNum, lngNum, limit ? Math.min(parseInt(limit, 10), 50) : 20)
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'EXECUTIVE' && req.user.role !== 'AUDITOR') throw new ForbiddenException()
    return this.stations.findOne(id)
  }

  @Post()
  async create(@Body() dto: CreateStationDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    const { station, deduped } = await this.stations.create(dto)
    if (!deduped) {
      await this.auditLog.log({
        userId: req.user.id,
        action: 'CREATE',
        entityType: 'Station',
        entityId: station.id,
        after: station,
      })
    }
    return station
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateStationDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.update(id, dto, req.user.id)
  }

  @SkipThrottle()
  @Post('batch-otp')
  async batchOtp(@Body() body: BatchOtpDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.stations.batchOtpImport(body.rows, req.user.id)
  }

  @Post(':id/checklist/:checklistId/approve')
  async approve(
    @Param('id') stationId: string,
    @Param('checklistId') checklistId: string,
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    const result = await this.stations.approveChecklist(stationId, checklistId)
    await this.auditLog.log({
      userId: req.user.id,
      action: 'APPROVE_CHECKLIST',
      entityType: 'Checklist',
      entityId: checklistId,
    })
    return result
  }

  @Post(':id/checklist/:checklistId/reject')
  async reject(
    @Param('id') stationId: string,
    @Param('checklistId') checklistId: string,
    @Body() body: { notes?: string },
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    const notes = (body.notes ?? '').trim()
    if (!notes) throw new BadRequestException('กรุณาระบุเหตุผลในการปฏิเสธ')
    const result = await this.stations.rejectChecklist(stationId, checklistId, notes)
    await this.auditLog.log({
      userId: req.user.id,
      action: 'REJECT_CHECKLIST',
      entityType: 'Checklist',
      entityId: checklistId,
      after: { status: 'REJECTED', reviewNotes: notes },
    })
    return result
  }

  @Patch(':id/checklist/:checklistId/items/:itemId/flag')
  async setItemFlag(
    @Param('id') stationId: string,
    @Param('checklistId') checklistId: string,
    @Param('itemId') itemId: string,
    @Body() body: { reviewFlag?: boolean },
    @Req() req: AuthRequest,
  ) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    const reviewFlag = body.reviewFlag === true
    const { checklist, before, after } = await this.stations.setItemFlag(stationId, checklistId, itemId, reviewFlag)
    await this.auditLog.log({
      userId: req.user.id,
      action: after ? 'FLAG_ITEM' : 'UNFLAG_ITEM',
      entityType: 'Checklist',
      entityId: checklistId,
      before: { itemId, reviewFlag: before },
      after: { itemId, reviewFlag: after },
    })
    return checklist
  }
}

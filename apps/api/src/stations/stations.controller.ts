import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { AuditLogService } from '../audit/audit.service'
import { StationsService } from './stations.service'
import { CreateStationDto } from './dto/create-station.dto'
import { BatchOtpDto } from './dto/otp-row.dto'

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
  summary() {
    return this.stations.summary()
  }

  // Must come before @Get(':id') to avoid route conflict
  @Get('pending-reviews')
  pendingReviews() {
    return this.stations.getPendingReviews()
  }

  @Get()
  findAll(
    @Query('mode')   mode?: string,
    @Query('region') region?: string,
    @Query('agency') responsibleAgency?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page')   page?: string,
    @Query('limit')  limit?: string,
  ) {
    return this.stations.findAll({
      mode, region, responsibleAgency, status, search,
      page:  page  ? parseInt(page,  10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    })
  }

  @Get('filters')
  getFilterOptions() {
    return this.stations.getFilterOptions()
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.stations.findOne(id)
  }

  @Post()
  async create(@Body() dto: CreateStationDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    const station = await this.stations.create(dto)
    await this.auditLog.log({
      userId: req.user.id,
      action: 'CREATE',
      entityType: 'Station',
      entityId: station.id,
      after: station,
    })
    return station
  }

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
}

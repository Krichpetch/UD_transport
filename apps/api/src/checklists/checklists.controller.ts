import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { ChecklistsService } from './checklists.service'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

@Controller('stations/:stationId/checklist')
@UseGuards(JwtAuthGuard)
export class ChecklistsController {
  constructor(private readonly checklists: ChecklistsService) {}

  @Get()
  findLatest(@Param('stationId') stationId: string) {
    return this.checklists.findLatest(stationId)
  }

  @Get('history')
  findAll(@Param('stationId') stationId: string) {
    return this.checklists.findAll(stationId)
  }

  @Post('draft')
  saveDraft(
    @Param('stationId') stationId: string,
    @Body() body: { items: unknown },
    @Req() req: AuthRequest,
  ) {
    return this.checklists.saveDraft(stationId, req.user.id, body.items)
  }

  @Post('submit')
  submit(
    @Param('stationId') stationId: string,
    @Body() body: { items: unknown; score?: number },
    @Req() req: AuthRequest,
  ) {
    return this.checklists.submit(stationId, req.user.id, body.items, body.score)
  }
}

import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard'
import { MasterCriteriaService } from './master-criteria.service'
import { CreateMasterCriterionDto } from './dto/create-master-criterion.dto'
import { EditMasterCriterionDto } from './dto/edit-master-criterion.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

// Session S5, Part D/F — the master facility editor's resource. Separate base path from
// admin/templates/:id, same rationale as FacilityGroupsController: a MasterCriterion isn't scoped
// to one ChecklistTemplate row. ADMIN-only, same manual role-check convention as every other
// controller in this codebase.
@Controller('admin/master-criteria')
@UseGuards(JwtAuthGuard)
export class MasterCriteriaController {
  constructor(private readonly masters: MasterCriteriaService) {}

  @Get()
  list(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.masters.list()
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.masters.get(id)
  }

  @Post()
  create(@Body() body: CreateMasterCriterionDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.masters.create(body, req.user.id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: EditMasterCriterionDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.masters.update(id, body, req.user.id)
  }
}

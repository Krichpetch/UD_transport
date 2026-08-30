import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Request } from 'express'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string; isSuperAdmin: boolean }
}

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Base gate stays "is an ADMIN". The finer sys-admin-vs-regular-admin policy (who may touch
  // admin-tier accounts / grant ADMIN or the sys-admin bit) lives in the service, since it needs
  // to load the target and count sys admins. See UDT-53.
  @Get()
  list(@Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.users.list()
  }

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.users.create(dto, req.user)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.users.update(id, dto, req.user)
  }

  @Patch(':id/deactivate')
  deactivate(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    if (id === req.user.id) throw new BadRequestException('ไม่สามารถปิดใช้งานบัญชีของตนเองได้')
    return this.users.setActive(id, false, req.user)
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string, @Req() req: AuthRequest) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException()
    return this.users.setActive(id, true, req.user)
  }
}

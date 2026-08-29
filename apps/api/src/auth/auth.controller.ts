import { Body, Controller, Get, HttpCode, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { Request } from 'express'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from './guards/jwt-auth.guard'
import { LoginDto } from './dto/login.dto'
import { ChangePasswordDto } from './dto/change-password.dto'
import { UpdateProfileDto } from './dto/update-profile.dto'

interface AuthRequest extends Request {
  user: { id: string; username: string; role: string }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto)
  }

  // Nest defaults POST to 201 with no body when the handler returns undefined,
  // which made the frontend's res.json() throw on an otherwise-successful change.
  // Returning an explicit body avoids that class of bug entirely.
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() req: AuthRequest) {
    return this.auth.changePassword(req.user.id, dto, req.ip)
  }

  // Cookie-backed session rehydration for a freshly opened tab (see AuthService.me).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthRequest) {
    return this.auth.me(req.user.id)
  }

  @UseGuards(JwtAuthGuard)
  @Patch('me')
  updateProfile(@Body() dto: UpdateProfileDto, @Req() req: AuthRequest) {
    return this.auth.updateProfile(req.user.id, dto, req.ip)
  }
}

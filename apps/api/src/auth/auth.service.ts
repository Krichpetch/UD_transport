import { Injectable, UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import * as bcrypt from 'bcryptjs'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { BCRYPT_ROUNDS } from '../config/constants'
import { LoginDto } from './dto/login.dto'
import { ChangePasswordDto } from './dto/change-password.dto'

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly auditLog: AuditLogService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      omit:  { passwordHash: false },
    })
    if (!user) throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')

    const valid = await bcrypt.compare(dto.password, user.passwordHash)
    if (!valid) throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')

    if (!user.isActive) throw new UnauthorizedException('บัญชีนี้ถูกปิดใช้งาน')

    const payload = { sub: user.id, username: user.username, role: user.role }
    return {
      access_token: this.jwt.sign(payload),
      user: { id: user.id, username: user.username, role: user.role },
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      omit:  { passwordHash: false },
    })
    if (!user) throw new UnauthorizedException()

    const valid = await bcrypt.compare(dto.currentPassword, user.passwordHash)
    if (!valid) throw new UnauthorizedException('รหัสผ่านปัจจุบันไม่ถูกต้อง')

    const passwordHash = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS)
    await this.prisma.user.update({
      where: { id: userId },
      data:  { passwordHash },
    })

    // Trade-off: existing JWTs stay valid until expiry after a password change.
    // Acceptable for the pilot — JwtStrategy.validate() already re-checks
    // isActive live on every request, so deactivation remains the kill switch.
    await this.auditLog.log({
      userId,
      action:     'PASSWORD_CHANGED',
      entityType: 'User',
      entityId:   userId,
      ipAddress,
    })
  }
}

import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import * as bcrypt from 'bcryptjs'
import { Prisma, UserRole } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { BCRYPT_ROUNDS } from '../config/constants'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

const USER_LIST_SELECT = {
  id: true, username: true, email: true, role: true, isActive: true, isSuperAdmin: true, agency: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect

// UDT-53 — the acting admin, as carried on req.user. `isSuperAdmin` decides whether they may
// manage admin-tier accounts and grant the ADMIN role / the sys-admin bit.
interface Actor {
  id: string
  isSuperAdmin: boolean
}

const ADMIN_ONLY_MANAGEMENT_MSG = 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการบัญชีผู้ดูแลระบบได้'
const LAST_SUPER_ADMIN_MSG = 'ต้องมีผู้ดูแลระบบสูงสุดที่ใช้งานอยู่อย่างน้อยหนึ่งบัญชี'

function generateTempPassword(): string {
  return randomBytes(9).toString('base64url')
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  list() {
    return this.prisma.user.findMany({
      select: USER_LIST_SELECT,
      orderBy: { createdAt: 'desc' },
    })
  }

  // Blocks the operation if it would leave zero active sys admins — no lockout of user management.
  private async assertNotLastSuperAdmin(excludeId: string) {
    const otherActiveSupers = await this.prisma.user.count({
      where: { isSuperAdmin: true, isActive: true, NOT: { id: excludeId } },
    })
    if (otherActiveSupers === 0) throw new BadRequestException(LAST_SUPER_ADMIN_MSG)
  }

  // Manual-add: admin sets a password, or the server generates a one-time temp
  // password returned only in this response — never stored or logged in plaintext.
  async create(dto: CreateUserDto, actor: Actor) {
    const role = (dto.role as UserRole) ?? 'AUDITOR'

    // Regular admins may only provision non-admin accounts, and may never grant the sys-admin bit.
    if (!actor.isSuperAdmin && (role === 'ADMIN' || dto.isSuperAdmin === true)) {
      throw new ForbiddenException(ADMIN_ONLY_MANAGEMENT_MSG)
    }
    // The sys-admin bit is only meaningful on an ADMIN account, and only a sys admin can set it.
    const isSuperAdmin = actor.isSuperAdmin && role === 'ADMIN' ? dto.isSuperAdmin === true : false

    const tempPassword = dto.password ?? generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    let user
    try {
      user = await this.prisma.user.create({
        data: {
          username: dto.username.trim(),
          email: dto.email.trim(),
          role,
          isSuperAdmin,
          agency: dto.agency,
          passwordHash,
        },
        select: USER_LIST_SELECT,
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว')
      }
      throw err
    }

    await this.auditLog.log({
      userId: actor.id,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      after: user,
    })

    // generatedPassword is only ever returned here, once, to the admin who created
    // the account — the DB stores only the bcrypt hash.
    return { ...user, generatedPassword: dto.password ? undefined : tempPassword }
  }

  async update(id: string, dto: UpdateUserDto, actor: Actor) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_LIST_SELECT })
    if (!before) throw new NotFoundException()

    // Regular admins can't touch admin-tier accounts, promote anyone to ADMIN, or grant the bit.
    if (!actor.isSuperAdmin && (before.role === 'ADMIN' || dto.role === 'ADMIN' || dto.isSuperAdmin === true)) {
      throw new ForbiddenException(ADMIN_ONLY_MANAGEMENT_MSG)
    }

    const nextRole = (dto.role as UserRole) ?? before.role
    // The sys-admin bit follows the role: only ADMIN accounts can hold it, so a demotion clears it.
    const nextSuperAdmin = nextRole !== 'ADMIN'
      ? false
      : dto.isSuperAdmin !== undefined
        ? dto.isSuperAdmin
        : before.isSuperAdmin

    if (before.isActive && before.isSuperAdmin && !nextSuperAdmin) {
      await this.assertNotLastSuperAdmin(id)
    }

    let after
    try {
      after = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.username !== undefined && { username: dto.username.trim() }),
          ...(dto.email    !== undefined && { email: dto.email.trim() }),
          ...(dto.role     !== undefined && { role: nextRole }),
          ...(dto.agency   !== undefined && { agency: dto.agency }),
          isSuperAdmin: nextSuperAdmin,
        },
        select: USER_LIST_SELECT,
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('ชื่อผู้ใช้หรืออีเมลนี้มีอยู่ในระบบแล้ว')
      }
      throw err
    }

    await this.auditLog.log({
      userId: actor.id, action: 'UPDATE', entityType: 'User', entityId: id, before, after,
    })
    return after
  }

  async setActive(id: string, isActive: boolean, actor: Actor) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_LIST_SELECT })
    if (!before) throw new NotFoundException()

    // Regular admins can't activate/deactivate admin-tier accounts.
    if (!actor.isSuperAdmin && before.role === 'ADMIN') {
      throw new ForbiddenException(ADMIN_ONLY_MANAGEMENT_MSG)
    }
    // Never deactivate the last active sys admin — that would lock out user management.
    if (!isActive && before.isActive && before.isSuperAdmin) {
      await this.assertNotLastSuperAdmin(id)
    }

    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: USER_LIST_SELECT,
    })

    await this.auditLog.log({
      userId: actor.id,
      action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      entityType: 'User',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    })
    return after
  }
}

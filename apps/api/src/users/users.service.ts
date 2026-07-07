import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { randomBytes } from 'crypto'
import * as bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { AuditLogService } from '../audit/audit.service'
import { BCRYPT_ROUNDS } from '../config/constants'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'

const USER_LIST_SELECT = {
  id: true, username: true, email: true, role: true, isActive: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect

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

  // Manual-add: admin sets a password, or the server generates a one-time temp
  // password returned only in this response — never stored or logged in plaintext.
  async create(dto: CreateUserDto, adminId: string) {
    const tempPassword = dto.password ?? generateTempPassword()
    const passwordHash = await bcrypt.hash(tempPassword, BCRYPT_ROUNDS)

    let user
    try {
      user = await this.prisma.user.create({
        data: {
          username: dto.username.trim(),
          email: dto.email.trim(),
          role: (dto.role as 'ADMIN' | 'AUDITOR' | 'EXECUTIVE') ?? 'AUDITOR',
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
      userId: adminId,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      after: user,
    })

    // generatedPassword is only ever returned here, once, to the admin who created
    // the account — the DB stores only the bcrypt hash.
    return { ...user, generatedPassword: dto.password ? undefined : tempPassword }
  }

  async update(id: string, dto: UpdateUserDto, adminId: string) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_LIST_SELECT })
    if (!before) throw new NotFoundException()

    let after
    try {
      after = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.username !== undefined && { username: dto.username.trim() }),
          ...(dto.email    !== undefined && { email: dto.email.trim() }),
          ...(dto.role      !== undefined && { role: dto.role as 'ADMIN' | 'AUDITOR' | 'EXECUTIVE' }),
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
      userId: adminId, action: 'UPDATE', entityType: 'User', entityId: id, before, after,
    })
    return after
  }

  async setActive(id: string, isActive: boolean, adminId: string) {
    const before = await this.prisma.user.findUnique({ where: { id }, select: USER_LIST_SELECT })
    if (!before) throw new NotFoundException()

    const after = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      select: USER_LIST_SELECT,
    })

    await this.auditLog.log({
      userId: adminId,
      action: isActive ? 'ACTIVATE' : 'DEACTIVATE',
      entityType: 'User',
      entityId: id,
      before: { isActive: before.isActive },
      after: { isActive: after.isActive },
    })
    return after
  }
}

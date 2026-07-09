import { UnauthorizedException } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import * as bcrypt from 'bcryptjs'
import { AuditLogService } from '../../audit/audit.service'
import { BCRYPT_ROUNDS } from '../../config/constants'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from '../auth.service'

describe('AuthService.changePassword', () => {
  let service: AuthService
  const findUnique = jest.fn()
  const update = jest.fn()
  const log = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: { user: { findUnique, update } } },
        { provide: JwtService, useValue: { sign: jest.fn() } },
        { provide: AuditLogService, useValue: { log } },
      ],
    }).compile()

    service = moduleRef.get(AuthService)
  })

  it('throws UnauthorizedException when the current password is wrong', async () => {
    const existingHash = await bcrypt.hash('correct-password', BCRYPT_ROUNDS)
    findUnique.mockResolvedValue({ id: 'u1', passwordHash: existingHash })

    await expect(
      service.changePassword(
        'u1',
        { currentPassword: 'wrong-password', newPassword: 'newpassword123' },
        '127.0.0.1',
      ),
    ).rejects.toThrow(UnauthorizedException)

    expect(update).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('re-hashes the new password with BCRYPT_ROUNDS and writes an audit log on success', async () => {
    const existingHash = await bcrypt.hash('correct-password', BCRYPT_ROUNDS)
    findUnique.mockResolvedValue({ id: 'u1', passwordHash: existingHash })
    update.mockResolvedValue({})

    await service.changePassword(
      'u1',
      { currentPassword: 'correct-password', newPassword: 'newpassword123' },
      '127.0.0.1',
    )

    expect(update).toHaveBeenCalledTimes(1)
    const { where, data } = update.mock.calls[0][0]
    expect(where).toEqual({ id: 'u1' })

    expect(bcrypt.getRounds(data.passwordHash)).toBe(BCRYPT_ROUNDS)
    await expect(bcrypt.compare('newpassword123', data.passwordHash)).resolves.toBe(true)

    expect(log).toHaveBeenCalledWith({
      userId: 'u1',
      action: 'PASSWORD_CHANGED',
      entityType: 'User',
      entityId: 'u1',
      ipAddress: '127.0.0.1',
    })
  })
})

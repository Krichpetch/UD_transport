// UDT-53 — sys-admin vs regular-admin authorization over user management. Verifies the matrix in
// users.service.ts: a regular admin (isSuperAdmin=false) may only manage non-admin accounts and
// can never grant the ADMIN role or the sys-admin bit; a sys admin may manage anyone; and no path
// may leave zero active sys admins (last-sys-admin lockout guard). Same Prisma/AuditLog mocking
// convention as the other *.service.spec.ts files. bcrypt is mocked so the BCRYPT_ROUNDS(12) hash
// never runs here (avoids the known under-load timeout).
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { UsersService } from '../users.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed-pw') }))

const REGULAR_ADMIN = { id: 'reg-1', isSuperAdmin: false }
const SYS_ADMIN = { id: 'sys-1', isSuperAdmin: true }

// USER_LIST_SELECT-shaped rows returned by findUnique.
const AUDITOR_ROW = { id: 'aud-1', username: 'aud', email: 'a@x', role: 'AUDITOR', isActive: true, isSuperAdmin: false, agency: null }
const ADMIN_ROW   = { id: 'adm-2', username: 'adm', email: 'b@x', role: 'ADMIN',   isActive: true, isSuperAdmin: false, agency: null }
const SYS_ROW     = { id: 'sys-9', username: 'sys', email: 'c@x', role: 'ADMIN',   isActive: true, isSuperAdmin: true,  agency: null }

describe('UsersService — UDT-53 sys-admin authorization', () => {
  let service: UsersService
  const findUnique = jest.fn()
  const create = jest.fn()
  const update = jest.fn()
  const count = jest.fn()
  const log = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findUnique.mockImplementation(({ where: { id } }: { where: { id: string } }) =>
      Promise.resolve([AUDITOR_ROW, ADMIN_ROW, SYS_ROW].find((r) => r.id === id) ?? null),
    )
    create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'new-1', ...data }))
    update.mockImplementation(({ where: { id }, data }: { where: { id: string }; data: Record<string, unknown> }) =>
      Promise.resolve({ ...[AUDITOR_ROW, ADMIN_ROW, SYS_ROW].find((r) => r.id === id), ...data }),
    )
    log.mockResolvedValue({})

    const moduleRef = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: { user: { findMany: jest.fn(), findUnique, create, update, count } } },
        { provide: AuditLogService, useValue: { log } },
      ],
    }).compile()
    service = moduleRef.get(UsersService)
  })

  describe('create', () => {
    it('blocks a regular admin from creating an ADMIN', async () => {
      await expect(service.create({ username: 'x', email: 'x@x', role: 'ADMIN' }, REGULAR_ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
      expect(create).not.toHaveBeenCalled()
    })

    it('blocks a regular admin from granting the sys-admin bit', async () => {
      await expect(service.create({ username: 'x', email: 'x@x', role: 'AUDITOR', isSuperAdmin: true }, REGULAR_ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
      expect(create).not.toHaveBeenCalled()
    })

    it('lets a regular admin create a non-admin (bit forced false)', async () => {
      await service.create({ username: 'x', email: 'x@x', role: 'AUDITOR' }, REGULAR_ADMIN)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'AUDITOR', isSuperAdmin: false }) }))
    })

    it('lets a sys admin create a sys admin', async () => {
      await service.create({ username: 'x', email: 'x@x', role: 'ADMIN', isSuperAdmin: true }, SYS_ADMIN)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'ADMIN', isSuperAdmin: true }) }))
    })

    it('forces the bit false for a non-admin even when a sys admin sets it', async () => {
      await service.create({ username: 'x', email: 'x@x', role: 'AUDITOR', isSuperAdmin: true }, SYS_ADMIN)
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isSuperAdmin: false }) }))
    })
  })

  describe('update', () => {
    it('blocks a regular admin from editing an admin-tier account', async () => {
      await expect(service.update(ADMIN_ROW.id, { email: 'new@x' }, REGULAR_ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
      expect(update).not.toHaveBeenCalled()
    })

    it('blocks a regular admin from promoting an auditor to ADMIN', async () => {
      await expect(service.update(AUDITOR_ROW.id, { role: 'ADMIN' }, REGULAR_ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
      expect(update).not.toHaveBeenCalled()
    })

    it('lets a regular admin edit a non-admin', async () => {
      await service.update(AUDITOR_ROW.id, { email: 'new@x' }, REGULAR_ADMIN)
      expect(update).toHaveBeenCalled()
    })

    it('blocks demoting the last active sys admin', async () => {
      count.mockResolvedValue(0) // no other active sys admins
      await expect(service.update(SYS_ROW.id, { role: 'AUDITOR' }, SYS_ADMIN)).rejects.toBeInstanceOf(BadRequestException)
      expect(update).not.toHaveBeenCalled()
    })

    it('allows demoting a sys admin when another active one remains', async () => {
      count.mockResolvedValue(1)
      await service.update(SYS_ROW.id, { role: 'AUDITOR' }, SYS_ADMIN)
      // role left ADMIN? no — demoted to AUDITOR, so bit must be cleared.
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ role: 'AUDITOR', isSuperAdmin: false }) }))
    })
  })

  describe('setActive', () => {
    it('blocks a regular admin from deactivating an admin-tier account', async () => {
      await expect(service.setActive(ADMIN_ROW.id, false, REGULAR_ADMIN)).rejects.toBeInstanceOf(ForbiddenException)
      expect(update).not.toHaveBeenCalled()
    })

    it('blocks deactivating the last active sys admin', async () => {
      count.mockResolvedValue(0)
      await expect(service.setActive(SYS_ROW.id, false, SYS_ADMIN)).rejects.toBeInstanceOf(BadRequestException)
      expect(update).not.toHaveBeenCalled()
    })

    it('lets a regular admin deactivate a non-admin', async () => {
      await service.setActive(AUDITOR_ROW.id, false, REGULAR_ADMIN)
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }))
    })
  })
})

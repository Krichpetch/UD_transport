/**
 * Regression test — user queries must never expose passwordHash.
 *
 * Currently FAILS: PrismaService extends PrismaClient with no omit config.
 * findFirst/findMany return passwordHash by default.
 *
 * Fix (makes this pass) — add a constructor to PrismaService:
 *   constructor() {
 *     super({ omit: { user: { passwordHash: true } } })
 *   }
 */

import { PrismaService } from '../prisma.service'

jest.mock('@prisma/client', () => {
  const MockClient = jest.fn().mockImplementation(
    (opts?: { omit?: { user?: { passwordHash?: boolean } } }) => {
      const strip = opts?.omit?.user?.passwordHash === true

      const raw = {
        id: 'u1',
        username: 'admin',
        email: 'admin@example.com',
        passwordHash: 'bcrypt-hash-must-not-leak',
        role: 'ADMIN',
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const sanitize = (u: typeof raw) => {
        if (!strip) return { ...u }
        const { passwordHash: _ph, ...rest } = u
        return rest
      }

      return {
        user: {
          findFirst: jest.fn().mockResolvedValue(sanitize(raw)),
          findMany:  jest.fn().mockResolvedValue([sanitize(raw)]),
        },
      }
    },
  )
  return { PrismaClient: MockClient }
})

describe('PrismaService › user queries omit passwordHash', () => {
  let service: PrismaService

  beforeEach(() => {
    service = new PrismaService()
  })

  it('findFirst does not return passwordHash', async () => {
    const user = await service.user.findFirst()
    expect(user).toBeTruthy()
    expect(user).not.toHaveProperty('passwordHash')
  })

  it('findMany does not return passwordHash on any row', async () => {
    const users = await service.user.findMany()
    expect(users.length).toBeGreaterThan(0)
    for (const user of users) {
      expect(user).not.toHaveProperty('passwordHash')
    }
  })
})

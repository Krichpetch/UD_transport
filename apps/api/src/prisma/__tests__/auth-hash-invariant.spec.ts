/**
 * Regression test — passwordHash omit invariant across query layers.
 *
 * Two directions:
 *   1. findUnique with omit: { passwordHash: false } MUST return passwordHash
 *      (the login query in auth.service re-enables it for bcrypt.compare).
 *      Remove the override → this test goes red → login always fails.
 *
 *   2. findUnique WITHOUT override MUST NOT return passwordHash
 *      (global omit in PrismaService constructor strips it everywhere else).
 *      Remove global omit → this test goes red → hash leaks into JWT validate, etc.
 */

import { PrismaService } from '../prisma.service'

jest.mock('@prisma/client', () => {
  const MockClient = jest.fn().mockImplementation(
    (constructorOpts?: { omit?: { user?: { passwordHash?: boolean } } }) => {
      const globalStrip = constructorOpts?.omit?.user?.passwordHash === true

      const raw = {
        id:           'u1',
        username:     'admin',
        email:        'admin@example.com',
        passwordHash: 'bcrypt-hash-must-not-leak',
        role:         'ADMIN',
        createdAt:    new Date(),
        updatedAt:    new Date(),
      }

      return {
        user: {
          findUnique: jest.fn().mockImplementation(
            (queryOpts?: { omit?: { passwordHash?: boolean } }) => {
              // query-level omit: false overrides the global strip
              const includeHash =
                queryOpts?.omit?.passwordHash === false ? true : !globalStrip
              if (includeHash) return Promise.resolve({ ...raw })
              const { passwordHash: _ph, ...rest } = raw
              return Promise.resolve(rest)
            },
          ),
        },
      }
    },
  )
  return { PrismaClient: MockClient }
})

describe('PrismaService › passwordHash omit invariant', () => {
  let service: PrismaService

  beforeEach(() => { service = new PrismaService() })

  it('standard findUnique (no override) strips passwordHash — global omit holds', async () => {
    const user = await service.user.findUnique({ where: { id: 'u1' } })
    expect(user).toBeTruthy()
    expect(user).not.toHaveProperty('passwordHash')
  })

  it('findUnique with omit:{passwordHash:false} returns passwordHash — login query can call bcrypt.compare', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = await (service.user.findUnique as any)({
      where: { username: 'admin' },
      omit:  { passwordHash: false },
    })
    expect(user).toBeTruthy()
    expect(user).toHaveProperty('passwordHash')
    expect(user.passwordHash).toBeTruthy()
  })
})

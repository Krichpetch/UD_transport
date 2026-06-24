/**
 * Security regression test — JWT_SECRET must be explicitly set.
 *
 * Enforcement lives in validateEnv() (src/config/validate-env.ts),
 * called in main.ts before app bootstrap. JwtStrategy reads
 * process.env.JWT_SECRET directly with no fallback.
 *
 * Tests 1 and 2 fail if validateEnv() is removed or its check is bypassed.
 * Test 3 is the sanity baseline.
 */

import { validateEnv } from '../../config/validate-env'

describe('validateEnv › missing JWT_SECRET', () => {
  let savedSecret: string | undefined

  beforeEach(() => {
    savedSecret = process.env.JWT_SECRET
    delete process.env.JWT_SECRET
  })

  afterEach(() => {
    if (savedSecret !== undefined) {
      process.env.JWT_SECRET = savedSecret
    } else {
      delete process.env.JWT_SECRET
    }
  })

  it('throws when JWT_SECRET env var is not set', () => {
    expect(() => validateEnv()).toThrow()
  })

  it('throws an error that mentions JWT_SECRET', () => {
    expect(() => validateEnv()).toThrow(/JWT_SECRET/)
  })
})

describe('validateEnv › JWT_SECRET set', () => {
  let savedSecret: string | undefined

  beforeEach(() => {
    savedSecret = process.env.JWT_SECRET
    process.env.JWT_SECRET = 'test-secret-long-enough-for-validation'
  })

  afterEach(() => {
    if (savedSecret !== undefined) {
      process.env.JWT_SECRET = savedSecret
    } else {
      delete process.env.JWT_SECRET
    }
  })

  it('does not throw when JWT_SECRET is set', () => {
    expect(() => validateEnv()).not.toThrow()
  })
})

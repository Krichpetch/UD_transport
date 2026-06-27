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
  const REQUIRED: Record<string, string> = {
    JWT_SECRET:            'test-secret-long-enough-for-validation',
    DATABASE_URL:          'postgresql://user:pass@localhost:5432/testdb',
    MINIO_ACCESS_KEY:      'test-access-key',
    MINIO_SECRET_KEY:      'test-secret-key',
    MINIO_PUBLIC_ENDPOINT: 'http://localhost:9000',
    FRONTEND_URL:          'http://localhost:3000',
  }
  let saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of Object.keys(REQUIRED)) {
      saved[key] = process.env[key]
      process.env[key] = REQUIRED[key]
    }
  })

  afterEach(() => {
    for (const key of Object.keys(REQUIRED)) {
      if (saved[key] !== undefined) {
        process.env[key] = saved[key] as string
      } else {
        delete process.env[key]
      }
    }
    saved = {}
  })

  it('does not throw when all required vars are set', () => {
    expect(() => validateEnv()).not.toThrow()
  })
})

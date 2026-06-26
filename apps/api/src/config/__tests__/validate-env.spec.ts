/**
 * Security regression tests — all required env vars must be explicitly set.
 *
 * Enforcement lives in validateEnv() (src/config/validate-env.ts).
 * Tests for each var FAIL until validateEnv() checks that var.
 */

import { validateEnv } from '../validate-env'

const REQUIRED_VARS = [
  'JWT_SECRET',
  'DATABASE_URL',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'FRONTEND_URL',
] as const

type RequiredVar = (typeof REQUIRED_VARS)[number]

const VALID_VALUES: Record<RequiredVar, string> = {
  JWT_SECRET:       'test-secret-long-enough-for-validation',
  DATABASE_URL:     'postgresql://user:pass@localhost:5432/testdb',
  MINIO_ACCESS_KEY: 'test-access-key',
  MINIO_SECRET_KEY: 'test-secret-key',
  FRONTEND_URL:     'http://localhost:3000',
}

describe('validateEnv › required environment variables', () => {
  let saved: Partial<Record<RequiredVar, string | undefined>> = {}

  beforeEach(() => {
    for (const key of REQUIRED_VARS) {
      saved[key] = process.env[key]
      process.env[key] = VALID_VALUES[key]
    }
  })

  afterEach(() => {
    for (const key of REQUIRED_VARS) {
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

  for (const varName of REQUIRED_VARS) {
    it(`throws when ${varName} is unset`, () => {
      delete process.env[varName]
      expect(() => validateEnv()).toThrow(new RegExp(varName))
    })
  }
})

const REQUIRED = [
  'JWT_SECRET',
  'DATABASE_URL',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_PUBLIC_ENDPOINT',
  'FRONTEND_URL',
] as const

export function validateEnv(): void {
  for (const key of REQUIRED) {
    if (!process.env[key]) {
      throw new Error(`FATAL: ${key} environment variable is not set`)
    }
  }
  if (process.env.JWT_SECRET!.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters')
  }
  // Fail-closed: the proximity bypass must be structurally impossible in production, not just
  // ignored at request time. If both are set, refuse to boot rather than silently no-op.
  if (process.env.APP_ENV === 'production' && process.env.PROXIMITY_BYPASS === 'true') {
    throw new Error('FATAL: PROXIMITY_BYPASS must not be set when APP_ENV=production')
  }
}

// Env-only, never a UI toggle. Server is the sole authority — a client-supplied flag is never
// trusted (see ChecklistsService.submit).
export function isProximityBypassActive(): boolean {
  return process.env.APP_ENV !== 'production' && process.env.PROXIMITY_BYPASS === 'true'
}

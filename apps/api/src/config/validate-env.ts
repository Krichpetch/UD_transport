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
}

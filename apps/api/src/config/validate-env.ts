export function validateEnv(): void {
  if (!process.env.JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set')
  }
}

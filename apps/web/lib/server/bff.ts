// Server-only helpers for the BFF (backend-for-frontend) auth proxy.
// The browser talks only to the Next web origin; these route handlers forward to
// the NestJS API server-to-server, attaching the JWT read from an httpOnly cookie.
import type { NextRequest } from 'next/server'

export const AUTH_COOKIE = 'access_token'

// Upstream NestJS API. NEXT_PUBLIC_API_URL is inlined at build time but also
// resolves server-side, so it doubles as the BFF's upstream target — no new env.
export const UPSTREAM = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Matches the API JWT expiresIn ('8h' in auth.module.ts signOptions).
export const SESSION_MAX_AGE = 8 * 60 * 60

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE,
  }
}

// Cookie-clearing options — same attributes minus maxAge so the browser drops it.
export function clearCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  }
}

// Real client IP the API needs for per-IP login throttling + AuditLog fidelity.
// Browser → Railway web edge → Next, so the leftmost X-Forwarded-For entry is the
// client. We forward it onward; the API trusts XFF (main.ts sets trust proxy).
export function clientIp(req: NextRequest): string | null {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')
}

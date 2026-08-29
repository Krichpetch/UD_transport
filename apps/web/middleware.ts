import { NextRequest, NextResponse } from 'next/server'

// Server-side auth gate. The session now lives in an httpOnly cookie the middleware
// can read (the old sessionStorage token was invisible here), so unauthenticated
// requests to protected areas are redirected to /login before any protected shell
// renders. This is a presence check only — the API remains the real authority, and
// per-role access is still enforced client-side (RequireRole) and in the API.
const AUTH_COOKIE = 'access_token'

export function middleware(req: NextRequest) {
  if (req.cookies.has(AUTH_COOKIE)) return NextResponse.next()

  const loginUrl = new URL('/login', req.url)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/dashboard/:path*',
    '/stations/:path*',
    '/users/:path*',
    '/audit/:path*',
    '/settings/:path*',
  ],
}

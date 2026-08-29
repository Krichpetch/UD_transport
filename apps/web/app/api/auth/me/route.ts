import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, UPSTREAM, clearCookieOptions, clientIp } from '@/lib/server/bff'

export const runtime = 'nodejs'

// GET: rehydrate the current user for a freshly opened tab. Since the JWT lives in
// an httpOnly cookie the browser JS can't read it, so a new tab asks the server.
export async function GET(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 })

  const ip = clientIp(req)
  const upstream = await fetch(`${UPSTREAM}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
  })

  const data = await upstream.json().catch(() => ({}))
  const res = NextResponse.json(data, { status: upstream.status })
  // Stale/expired session upstream → clear the dead cookie so middleware + UI agree.
  if (upstream.status === 401) res.cookies.set(AUTH_COOKIE, '', clearCookieOptions())
  return res
}

// PATCH: profile update (displayName). This dedicated /auth/me route shadows the
// catch-all proxy for this path, so mutations must be forwarded here explicitly.
export async function PATCH(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 })

  const ip = clientIp(req)
  const upstream = await fetch(`${UPSTREAM}/auth/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: await req.text(),
  })

  const data = await upstream.json().catch(() => ({}))
  return NextResponse.json(data, { status: upstream.status })
}

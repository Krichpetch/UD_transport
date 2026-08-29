import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, UPSTREAM, clientIp, sessionCookieOptions } from '@/lib/server/bff'

export const runtime = 'nodejs'

// Exchanges credentials for a session: calls the upstream API, then stores the
// returned JWT in an httpOnly cookie on the web origin. The token is never sent
// to the browser JS — only { user } comes back, which the client keeps in memory.
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const upstream = await fetch(`${UPSTREAM}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(ip ? { 'x-forwarded-for': ip } : {}),
    },
    body: await req.text(),
  })

  const data = (await upstream.json().catch(() => ({}))) as {
    access_token?: string
    user?: unknown
  }

  if (!upstream.ok || !data.access_token) {
    // Pass the API's structured error body + status through so the login form
    // shows the same messages (bad creds, deactivated, 429 throttle).
    const res = NextResponse.json(data, { status: upstream.status })
    const retryAfter = upstream.headers.get('Retry-After')
    if (retryAfter) res.headers.set('Retry-After', retryAfter)
    return res
  }

  const res = NextResponse.json({ user: data.user }, { status: 200 })
  res.cookies.set(AUTH_COOKIE, data.access_token, sessionCookieOptions())
  return res
}

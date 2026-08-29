import { NextResponse } from 'next/server'
import { AUTH_COOKIE, clearCookieOptions } from '@/lib/server/bff'

export const runtime = 'nodejs'

// Ends the session by clearing the httpOnly cookie. Cross-tab propagation is
// handled client-side via BroadcastChannel; this just drops the credential.
export async function POST() {
  const res = new NextResponse(null, { status: 204 })
  res.cookies.set(AUTH_COOKIE, '', clearCookieOptions())
  return res
}

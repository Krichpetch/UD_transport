import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, UPSTREAM, clearCookieOptions, clientIp } from '@/lib/server/bff'

export const runtime = 'nodejs'

// Generic BFF proxy: every browser API call hits the web origin (same-origin, so
// the httpOnly cookie is sent automatically), and this forwards it to the upstream
// NestJS API with the JWT as a Bearer header. Bodies stream both ways so multipart
// photo uploads and binary responses (xlsx) pass through untouched.
// More specific routes (app/api/auth/*, app/api/export/*) take precedence over this.
async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const token = req.cookies.get(AUTH_COOKIE)?.value
  const url = `${UPSTREAM}/${path.join('/')}${req.nextUrl.search}`

  const headers = new Headers()
  const contentType = req.headers.get('content-type')
  if (contentType) headers.set('content-type', contentType)
  const accept = req.headers.get('accept')
  if (accept) headers.set('accept', accept)
  if (token) headers.set('authorization', `Bearer ${token}`)
  const ip = clientIp(req)
  if (ip) headers.set('x-forwarded-for', ip)

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD'

  // `duplex: 'half'` is required by fetch/undici when streaming a request body.
  const init: RequestInit & { duplex?: 'half' } = {
    method: req.method,
    headers,
    redirect: 'manual',
  }
  if (hasBody) {
    init.body = req.body
    init.duplex = 'half'
  }

  const upstream = await fetch(url, init)

  // Strip hop-by-hop / encoding headers: undici already decoded the body, so
  // forwarding content-encoding/length would mislabel it.
  const resHeaders = new Headers(upstream.headers)
  resHeaders.delete('content-encoding')
  resHeaders.delete('content-length')
  resHeaders.delete('transfer-encoding')
  resHeaders.delete('connection')

  const res = new NextResponse(upstream.body, { status: upstream.status, headers: resHeaders })
  if (upstream.status === 401) res.cookies.set(AUTH_COOKIE, '', clearCookieOptions())
  return res
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path)
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path)
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path)
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path)
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path)
}

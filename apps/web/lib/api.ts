import { useAuthStore } from '@/stores/auth.store'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Thrown instead of a plain Error when the API responds with a structured
// { code, message, ... } body (e.g. the proximity gate's LOCATION_REQUIRED / OUT_OF_RANGE) —
// callers can branch on `.code` instead of parsing `.message` text.
export class ApiError extends Error {
  code?: string
  status: number
  data: Record<string, unknown>
  constructor(message: string, status: number, data: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.data = data
    this.code = typeof data.code === 'string' ? data.code : undefined
  }
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = useAuthStore.getState().token
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: buildHeaders(init?.headers),
  })

  if (!res.ok) {
    if (res.status === 429) {
      const retryAfter = res.headers.get('Retry-After')
      const wait = retryAfter ? ` (ลองใหม่ใน ${retryAfter} วินาที)` : ''
      throw new Error(`คำขอถี่เกินไป กรุณารอสักครู่${wait}`)
    }
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    const message = typeof body.message === 'string' ? body.message : `HTTP ${res.status}`
    throw new ApiError(message, res.status, body)
  }

  // 204 No Content
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  get:    <T>(path: string, signal?: AbortSignal) => request<T>(path, signal ? { signal } : undefined),
  post:   <T>(path: string, body: unknown)        => request<T>(path, { method: 'POST',   body: JSON.stringify(body) }),
  put:    <T>(path: string, body: unknown)        => request<T>(path, { method: 'PUT',    body: JSON.stringify(body) }),
  delete: <T>(path: string)                       => request<T>(path, { method: 'DELETE' }),
}

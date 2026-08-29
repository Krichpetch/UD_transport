import type { ChecklistPhoto } from '@repo/types'

// Same-origin BFF proxy — the httpOnly session cookie is sent automatically and the
// proxy streams the multipart body upstream, attaching the Bearer token itself.
// No Authorization header and no manual Content-Type (the browser sets the
// multipart boundary).
const BASE_URL = '/api'

export async function uploadPhoto(file: File): Promise<ChecklistPhoto> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/uploads/photo`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<ChecklistPhoto>
}

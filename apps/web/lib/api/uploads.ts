import { useAuthStore } from '@/stores/auth.store'
import type { ChecklistPhoto } from '@repo/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export async function uploadPhoto(file: File): Promise<ChecklistPhoto> {
  const token = useAuthStore.getState().token
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/uploads/photo`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<ChecklistPhoto>
}

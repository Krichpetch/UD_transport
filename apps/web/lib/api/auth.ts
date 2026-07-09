import { api } from '@/lib/api'
import type { UserRole } from '@repo/types'

export interface LoginResponse {
  access_token: string
  user: { id: string; username: string; role: UserRole }
}

export function login(username: string, password: string) {
  return api.post<LoginResponse>('/auth/login', { username, password })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api.post<void>('/auth/change-password', { currentPassword, newPassword })
}

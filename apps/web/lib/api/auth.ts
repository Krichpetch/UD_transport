import { api } from '@/lib/api'
import type { UserRole } from '@repo/types'

export interface AuthUserResponse {
  id: string
  username: string
  role: UserRole
  displayName: string | null
}

export interface LoginResponse {
  access_token: string
  user: AuthUserResponse
}

export function login(username: string, password: string) {
  return api.post<LoginResponse>('/auth/login', { username, password })
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword })
}

export function updateProfile(displayName: string) {
  return api.patch<AuthUserResponse>('/auth/me', { displayName })
}

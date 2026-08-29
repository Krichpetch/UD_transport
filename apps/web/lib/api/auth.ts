import { api } from '@/lib/api'
import type { UserRole } from '@repo/types'

export interface AuthUserResponse {
  id: string
  username: string
  role: UserRole
  displayName: string | null
}

// The BFF login route stores the JWT in an httpOnly cookie and returns only the
// user — the token never reaches the browser.
export interface LoginResponse {
  user: AuthUserResponse
}

export function login(username: string, password: string) {
  return api.post<LoginResponse>('/auth/login', { username, password })
}

// Rehydrates the current user from the httpOnly session cookie (fresh-tab bootstrap).
export function getMe() {
  return api.get<AuthUserResponse>('/auth/me')
}

// Clears the session cookie server-side.
export function logout() {
  return api.post<void>('/auth/logout', {})
}

export function changePassword(currentPassword: string, newPassword: string) {
  return api.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword })
}

export function updateProfile(displayName: string) {
  return api.patch<AuthUserResponse>('/auth/me', { displayName })
}

import { api } from '@/lib/api'
import type { UserRole } from '@repo/types'

export interface UserRecord {
  id: string
  username: string
  email: string
  role: UserRole
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface CreatedUserRecord extends UserRecord {
  // Only present once, in the response to createUser() — a one-time temp
  // password shown to the admin when they didn't set one manually.
  generatedPassword?: string
}

export interface CreateUserInput {
  username: string
  email: string
  role?: UserRole
  password?: string
}

export interface UpdateUserInput {
  username?: string
  email?: string
  role?: UserRole
}

export function getUsers() {
  return api.get<UserRecord[]>('/users')
}

export function createUser(data: CreateUserInput) {
  return api.post<CreatedUserRecord>('/users', data)
}

export function updateUser(id: string, data: UpdateUserInput) {
  return api.patch<UserRecord>(`/users/${id}`, data)
}

export function deactivateUser(id: string) {
  return api.patch<UserRecord>(`/users/${id}/deactivate`, {})
}

export function activateUser(id: string) {
  return api.patch<UserRecord>(`/users/${id}/activate`, {})
}

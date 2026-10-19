import { apiClient } from './client'
import type { PaginatedUsers, User, UserCreate, UserUpdate } from './types'

export interface UserFilters {
  search?: string
  global_role?: string
  is_active?: string
  limit: number
  offset: number
}

export async function listUsers(filters: UserFilters): Promise<PaginatedUsers> {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null))
  const { data } = await apiClient.get<PaginatedUsers>('/api/v1/users/', { params })
  return data
}

export async function createUser(payload: UserCreate): Promise<User> {
  const { data } = await apiClient.post<User>('/api/v1/users/', payload)
  return data
}

export async function updateUser(id: string, changes: UserUpdate): Promise<User> {
  const { data } = await apiClient.patch<User>(`/api/v1/users/${id}/`, changes)
  return data
}

export async function resetUserPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.post(`/api/v1/users/${id}/reset-password/`, { new_password: newPassword })
}

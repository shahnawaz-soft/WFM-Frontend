import { apiClient, refreshAccessToken } from './client'
import type { CurrentUser, Session } from './types'
import { tokenStore } from '../auth/tokenStore'

/** `login` is an email address or a username. */
export async function login(login: string, password: string): Promise<Session> {
  const { data } = await apiClient.post<Session>('/api/v1/auth/login/', { login, password })
  tokenStore.set(data.access)
  return data
}

/** Restore a session from the refresh cookie (e.g. after a page reload). */
export async function restoreSession(): Promise<CurrentUser> {
  await refreshAccessToken()
  return fetchCurrentUser()
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post('/api/v1/auth/logout/')
  } finally {
    tokenStore.set(null)
  }
}

export async function fetchCurrentUser(): Promise<CurrentUser> {
  const { data } = await apiClient.get<CurrentUser>('/api/v1/auth/me/')
  return data
}

export async function updateProfile(changes: {
  first_name?: string
  last_name?: string
}): Promise<CurrentUser> {
  const { data } = await apiClient.patch<CurrentUser>('/api/v1/auth/me/', changes)
  return data
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const { data } = await apiClient.post<Session>('/api/v1/auth/change-password/', {
    current_password: currentPassword,
    new_password: newPassword,
  })
  tokenStore.set(data.access)
  return data
}

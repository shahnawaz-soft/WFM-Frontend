import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'

import { tokenStore } from '../auth/tokenStore'
import { env } from '../lib/env'
import { toApiError } from './errors'

/**
 * Single HTTP client for the app.
 * - Attaches the in-memory access token.
 * - On 401, renews the session once via the refresh cookie (one shared request even if
 *   many calls fail together), then replays the original request.
 * - Every failure is converted into an `ApiError`.
 */
export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 30_000,
  withCredentials: true, // refresh cookie on the API's (sibling) domain
  headers: {
    Accept: 'application/json',
    // Required by cookie-authenticated auth endpoints (CSRF defence, see backend cookies.py).
    'X-Requested-With': 'XMLHttpRequest',
  },
})

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retried?: boolean
}

const AUTH_PATHS = ['/api/v1/auth/login/', '/api/v1/auth/refresh/', '/api/v1/auth/logout/']
const AUTH_PREFIX = '/api/v1/auth/' // the refresh cookie's path

let refreshInFlight: Promise<string> | null = null

/** Renew the access token from the refresh cookie. Shared by concurrent callers. */
export function refreshAccessToken(): Promise<string> {
  refreshInFlight ??= apiClient
    .post<{ access: string }>('/api/v1/auth/refresh/')
    .then(({ data }) => {
      tokenStore.set(data.access)
      return data.access
    })
    .finally(() => {
      refreshInFlight = null
    })
  return refreshInFlight
}

apiClient.interceptors.request.use((config) => {
  if (config.url?.startsWith(AUTH_PREFIX)) config.baseURL = env.authBaseUrl
  const token = tokenStore.get()
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined
    const isAuthCall = AUTH_PATHS.some((path) => config?.url?.endsWith(path))

    if (error.response?.status === 401 && config && !config._retried && !isAuthCall) {
      config._retried = true
      try {
        const token = await refreshAccessToken()
        config.headers.Authorization = `Bearer ${token}`
        return apiClient(config)
      } catch {
        tokenStore.expire()
      }
    }
    return Promise.reject(toApiError(error))
  },
)

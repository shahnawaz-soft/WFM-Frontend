/**
 * Build-time configuration. Vite inlines VITE_* variables at build time, so a deployed
 * build is tied to its API URL.
 */
const STAGING_API_BASE_URL = 'https://steelo-api.staging.steel.study'

export function resolveApiBaseUrl(configuredUrl: string | undefined, isProduction: boolean): string {
  const defaultUrl = isProduction ? STAGING_API_BASE_URL : ''
  return (configuredUrl?.trim() || defaultUrl).replace(/\/+$/, '')
}

export const env = {
  /** Empty string = same origin (local dev uses the Vite proxy). */
  apiBaseUrl: resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD),
  appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
} as const

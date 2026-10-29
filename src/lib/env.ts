/**
 * Build-time configuration. Vite inlines VITE_* variables at build time, so a deployed
 * build is tied to its API URL.
 */
const STAGING_API_BASE_URL = 'https://steelo-api.staging.steel.study'

export function resolveApiBaseUrl(configuredUrl: string | undefined, isProduction: boolean): string {
  const defaultUrl = isProduction ? STAGING_API_BASE_URL : ''
  return (configuredUrl?.trim() || defaultUrl).replace(/\/+$/, '')
}

/**
 * Where /api/v1/auth/ calls go. The refresh cookie lives on whichever host answers them, so a
 * frontend on another site (Vercel) sends them to its own origin, which rewrites them to the
 * API: the cookie is then first-party and survives a reload. Everything else, including large
 * uploads, still goes straight to the API with the bearer token.
 */
export function resolveAuthBaseUrl(sameOrigin: string | undefined, apiBaseUrl: string): string {
  return sameOrigin?.trim() === 'true' ? '' : apiBaseUrl
}

const apiBaseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD)

export const env = {
  /** Empty string = same origin (local dev uses the Vite proxy). */
  apiBaseUrl,
  authBaseUrl: resolveAuthBaseUrl(import.meta.env.VITE_AUTH_SAME_ORIGIN, apiBaseUrl),
  appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
} as const

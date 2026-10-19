/**
 * Build-time configuration. Vite inlines VITE_* variables at build time, so a deployed
 * build is tied to its API URL (set in the App Platform spec).
 */
export const env = {
  /** Empty string = same origin (local dev uses the Vite proxy). */
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, ''),
  appVersion: import.meta.env.VITE_APP_VERSION ?? 'dev',
} as const

import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrl, resolveAuthBaseUrl } from './env'

describe('resolveApiBaseUrl', () => {
  it('uses the Vite proxy by default in development', () => {
    expect(resolveApiBaseUrl(undefined, false)).toBe('')
    expect(resolveApiBaseUrl('', false)).toBe('')
  })

  it('uses staging by default in production when no API URL is configured', () => {
    expect(resolveApiBaseUrl(undefined, true)).toBe('https://steelo-api.staging.steel.study')
    expect(resolveApiBaseUrl('', true)).toBe('https://steelo-api.staging.steel.study')
  })

  it('preserves an explicitly configured API URL', () => {
    expect(resolveApiBaseUrl('https://api.example.test/', true)).toBe('https://api.example.test')
    expect(resolveApiBaseUrl('https://api.example.test/', false)).toBe('https://api.example.test')
  })
})

describe('resolveAuthBaseUrl', () => {
  it('uses the API URL unless sign-in is proxied through the frontend’s own origin', () => {
    const api = 'https://steelo-api.staging.steel.study'
    expect(resolveAuthBaseUrl(undefined, api)).toBe(api)
    expect(resolveAuthBaseUrl('false', api)).toBe(api)
    expect(resolveAuthBaseUrl('true', api)).toBe('') // Vercel rewrites /api/v1/auth/ to the API
  })
})

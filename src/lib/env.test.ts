import { describe, expect, it } from 'vitest'

import { resolveApiBaseUrl } from './env'

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

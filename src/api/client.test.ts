import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'

import { server } from '../test/server'

vi.mock('../lib/env', () => ({
  env: { apiBaseUrl: 'https://api.example.test', authBaseUrl: '', appVersion: 'test' },
}))

const { apiClient } = await import('./client')

describe('apiClient', () => {
  it('sends sign-in calls to the auth origin and everything else to the API', async () => {
    const seen: string[] = []
    server.use(
      http.post('*/api/v1/auth/refresh/', ({ request }) => {
        seen.push(request.url)
        return HttpResponse.json({ access: 't' })
      }),
      http.get('*/api/v1/projects/', ({ request }) => {
        seen.push(request.url)
        return HttpResponse.json([])
      }),
    )
    await apiClient.post('/api/v1/auth/refresh/')
    await apiClient.get('/api/v1/projects/')
    expect(new URL(seen[0]!).origin).toBe(window.location.origin)
    expect(seen[1]).toBe('https://api.example.test/api/v1/projects/')
  })
})

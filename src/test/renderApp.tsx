import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, matchRoutes } from 'react-router'

import { App } from '../app/App'
import { createQueryClient } from '../app/queryClient'
import { routes } from '../app/router'

export function createTestQueryClient(): QueryClient {
  const client = createQueryClient()
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, retry: false },
  })
  return client
}

/** Loads the lazy route modules of these paths up front (call it in beforeAll, after the file's
 *  vi.mock calls are registered). Otherwise a lazy route's modules load inside the test's first
 *  findBy, which on a busy machine can use most of its wait before any request is made. */
export async function preloadRoutes(...paths: string[]) {
  const matches = paths.flatMap((path) => matchRoutes(routes, path) ?? [])
  await Promise.all(matches.map(({ route }) => (typeof route.lazy === 'function' ? route.lazy() : undefined)))
}

export function renderApp(path = '/') {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return { queryClient, router, ...render(<App queryClient={queryClient} router={router} />) }
}

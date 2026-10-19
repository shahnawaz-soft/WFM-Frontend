import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter } from 'react-router'

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

export function renderApp(path = '/') {
  const queryClient = createTestQueryClient()
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return { queryClient, router, ...render(<App queryClient={queryClient} router={router} />) }
}

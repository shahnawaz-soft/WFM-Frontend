import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { RouterProvider, type createBrowserRouter } from 'react-router'

import { AuthProvider } from '../auth/AuthProvider'
import { ErrorBoundary } from '../components/feedback/ErrorBoundary'
import { Toaster } from '../components/feedback/Toaster'
import { createQueryClient } from './queryClient'
import { createRouter } from './router'

type Router = ReturnType<typeof createBrowserRouter>

interface AppProps {
  /** Injected in tests; created once per app instance otherwise. */
  queryClient?: QueryClient
  router?: Router
}

export function App({ queryClient, router }: AppProps) {
  const [client] = useState(() => queryClient ?? createQueryClient())
  const [appRouter] = useState(() => router ?? createRouter())

  return (
    <ErrorBoundary>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <RouterProvider router={appRouter} />
        </AuthProvider>
        <Toaster />
      </QueryClientProvider>
    </ErrorBoundary>
  )
}

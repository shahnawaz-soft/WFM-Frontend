import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

import { toApiError } from '../api/errors'
import { notify } from '../components/feedback/toastStore'

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: { suppressErrorToast?: boolean; successMessage?: string }
  }
}

function isClientError(error: unknown): boolean {
  const { status } = toApiError(error)
  return status !== null && status >= 400 && status < 500
}

/**
 * Global error policy:
 * - First-load query failures render inline (<ErrorState>) in the view that owns them.
 * - Background refetch failures (data already on screen) raise a notification instead.
 * - Mutation failures raise a notification unless the form shows them inline
 *   (`meta: { suppressErrorToast: true }`).
 * - 4xx responses are never retried; network/5xx errors retry twice.
 */
/** A PDF.js document (['drawing-set', id, 'pdf']), typed by shape so PDF.js stays out of this chunk. */
function isPdfDocument(key: readonly unknown[], data: unknown): data is { destroy: () => Promise<void> } {
  return key[0] === 'drawing-set' && key[2] === 'pdf' && typeof (data as { destroy?: unknown } | undefined)?.destroy === 'function'
}

export function createQueryClient() {
  const client = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.state.data !== undefined) {
          notify.error('Could not refresh data', toApiError(error).message)
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (!mutation.meta?.suppressErrorToast) {
          notify.error('Action failed', toApiError(error).message)
        }
      },
      onSuccess: (_data, _vars, _ctx, mutation) => {
        if (mutation.meta?.successMessage) notify.success(mutation.meta.successMessage)
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => !isClientError(error) && failureCount < 2,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  })
  // A PDF document holds its memory in the PDF.js worker until destroyed. The cache removes a
  // query only once no view observes it (after gcTime) or on removeQueries, so no viewer is
  // still drawing from it.
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return
    const { queryKey, state } = event.query
    if (isPdfDocument(queryKey, state.data)) void state.data.destroy()
  })
  return client
}

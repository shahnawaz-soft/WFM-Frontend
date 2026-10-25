import { QueryObserver } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from './queryClient'

const GC_TIME = 5 * 60_000

describe('PDF documents in the cache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function watchPdf() {
    const client = createQueryClient()
    const doc = { destroy: vi.fn(async () => {}) }
    const observer = new QueryObserver(client, {
      queryKey: ['drawing-set', 's1', 'pdf'],
      queryFn: () => doc,
      staleTime: Infinity,
      gcTime: GC_TIME,
    })
    const unsubscribe = observer.subscribe(() => {})
    return { client, doc, unsubscribe }
  }

  it('are kept while a viewer still uses them', async () => {
    const { doc } = watchPdf()
    await vi.advanceTimersByTimeAsync(GC_TIME * 2)
    expect(doc.destroy).not.toHaveBeenCalled()
  })

  it('are destroyed once the cache drops them', async () => {
    const { doc, unsubscribe } = watchPdf()
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    await vi.advanceTimersByTimeAsync(GC_TIME - 1)
    expect(doc.destroy).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(doc.destroy).toHaveBeenCalledTimes(1)
  })

  it('are destroyed when removed explicitly', async () => {
    const { client, doc, unsubscribe } = watchPdf()
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    client.removeQueries({ queryKey: ['drawing-set', 's1'] })
    expect(doc.destroy).toHaveBeenCalledTimes(1)
  })

  it('leave other queries alone', async () => {
    const client = createQueryClient()
    const data = { destroy: vi.fn() }
    client.setQueryData(['drawing-set', 's1'], data)
    client.removeQueries({ queryKey: ['drawing-set', 's1'] })
    expect(data.destroy).not.toHaveBeenCalled()
  })
})

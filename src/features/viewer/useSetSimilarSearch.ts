import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { toApiError } from '../../api/errors'
import { getSimilarColumnsJob, startSimilarColumnsJob } from '../../api/processing'
import type { SimilarColumnsJob } from '../../api/types'

/** How often a running search is polled. A setting, not a constant, so tests can poll quickly. */
export const similarSearchPolling = { intervalMs: 2000 }

/** The latest set-wide search per drawing set, for this browser tab. The job runs on when the
 *  person leaves the page; coming back to any page of the set shows it again. */
const jobBySet = new Map<string, string>()
/** Searches whose end has been acted on (queries refreshed), so a return visit does not repeat it. */
const handled = new Set<string>()

export const isSearching = (job: SimilarColumnsJob | undefined) => job?.status === 'queued' || job?.status === 'processing'

/** "Find similar" on every plan of a drawing set, run by a worker: start it, follow its
 *  progress, and call ``onChanged`` once it has added columns (completed, or stopped part-way
 *  with some added). One search per set at a time, for everyone: when one is already running,
 *  even another person's, this follows that one instead. */
export function useSetSimilarSearch(pageId: string, setId: string | undefined, onChanged: () => void) {
  const queryClient = useQueryClient()
  const [shown, setShown] = useState(() => ({ setId, jobId: setId ? (jobBySet.get(setId) ?? null) : null }))
  // Another set opened in the same viewer: show that set's search, if any.
  if (shown.setId !== setId) setShown({ setId, jobId: setId ? (jobBySet.get(setId) ?? null) : null })
  const jobId = shown.setId === setId ? shown.jobId : null

  const follow = (id: string) => {
    if (setId) jobBySet.set(setId, id)
    setShown({ setId, jobId: id })
  }

  const job = useQuery({
    queryKey: ['similar-columns-job', jobId],
    queryFn: () => getSimilarColumnsJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (isSearching(query.state.data) ? similarSearchPolling.intervalMs : false),
  })

  const start = useMutation({
    mutationFn: (point: [number, number]) => startSimilarColumnsJob(pageId, point),
    // Shown next to the button; "already running" is not an error at all.
    meta: { suppressErrorToast: true },
    onSuccess: (started) => {
      queryClient.setQueryData(['similar-columns-job', started.id], started)
      follow(started.id)
    },
    onError: (error) => {
      const apiError = toApiError(error)
      const running = (apiError.details as { job_id?: unknown } | null)?.job_id
      if (apiError.code === 'similar_search_running' && typeof running === 'string') follow(running)
    },
  })

  const ended = job.data && !isSearching(job.data) ? job.data : undefined
  useEffect(() => {
    if (!ended || handled.has(ended.id)) return
    handled.add(ended.id)
    if (ended.status === 'completed' || (ended.result?.added ?? 0) > 0) onChanged()
  }, [ended, onChanged])

  const startError = start.error && toApiError(start.error).code !== 'similar_search_running' ? toApiError(start.error) : null

  return {
    /** The search shown for this set (running, or ended until dismissed). */
    job: job.data,
    start: (point: [number, number]) => start.mutate(point),
    starting: start.isPending,
    /** Why it could not start (e.g. ``no_symbol``, ``page_not_run``): the backend's message. */
    startError,
    dismiss: () => {
      if (setId) jobBySet.delete(setId)
      setShown({ setId, jobId: null })
      start.reset()
    },
  }
}

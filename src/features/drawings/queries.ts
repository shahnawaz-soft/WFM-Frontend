import { queryOptions } from '@tanstack/react-query'

import { listBatches, listDrawingSets, listPages } from '../../api/drawings'
import type { DrawingSet } from '../../api/types'
import { isActiveJob } from './status'

const POLL_MS = 2000

/** A project's drawing sets. Shared by the project page (which starts it with the project, not
 *  after it) and the Drawings section (which shows it). */
export const drawingSetsQuery = (projectId: string) =>
  queryOptions({
    queryKey: ['project', projectId, 'drawing-sets'],
    queryFn: () => listDrawingSets(projectId),
    // Keep checking while pages are being prepared in the background.
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'processing') ? POLL_MS : false),
  })

/** A drawing set's pages, refreshed as the set changes and polled while any page is running.
 *  Shared by the set's grid and the batch sections, which show the same pages. */
export const pagesQuery = (drawingSet: DrawingSet) =>
  queryOptions({
    queryKey: ['drawing-set', drawingSet.id, 'pages', drawingSet.status, drawingSet.pages_ready, drawingSet.pages_failed],
    queryFn: () => listPages(drawingSet.id),
    placeholderData: (previous) => previous,
    refetchInterval: (q) => (q.state.data?.some((p) => isActiveJob(p.latest_job)) ? POLL_MS : false),
  })

export const batchesQuery = (projectId: string) =>
  queryOptions({ queryKey: ['project', projectId, 'batches'], queryFn: () => listBatches(projectId) })

import { queryOptions } from '@tanstack/react-query'

import { listDrawingSets } from '../../api/drawings'

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

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { fetchPagePdf } from '../../api/drawings'
import { loadPdf } from './pdf'

/** The page's own one-page PDF (its page 1), not its whole set: staging, 16 Nov 2026, the
 *  viewer downloaded BLDG 12's 77.9 MB set to show a page of 0.28 MB. Same size, box and
 *  rotation as in the set, so what is drawn over it lines up as before. */
export const pagePdfQuery = (pageId: string, onProgress?: (loaded: number, total: number | undefined) => void) => ({
  queryKey: ['page-pdf', pageId],
  queryFn: async () => loadPdf(await fetchPagePdf(pageId, onProgress)),
  staleTime: Infinity, // a set's pages never change
  gcTime: 5 * 60_000,
  retry: false,
})

/** The page's PDF, and the pages either side fetched ahead once it is in. */
export function usePagePdf(
  pageId: string | undefined,
  neighbours: (string | undefined)[] = [],
  onProgress?: (loaded: number, total: number | undefined) => void,
) {
  const queryClient = useQueryClient()
  const pdf = useQuery({ ...pagePdfQuery(pageId ?? '', onProgress), enabled: Boolean(pageId) })
  const ahead = neighbours.filter(Boolean).join(',')
  const loaded = Boolean(pdf.data)
  useEffect(() => {
    if (!loaded) return // this page first
    for (const id of ahead.split(',').filter(Boolean)) void queryClient.prefetchQuery(pagePdfQuery(id))
  }, [loaded, ahead, queryClient])
  return pdf
}

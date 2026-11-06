import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'

import { fetchPagePreview } from '../../api/drawings'

export const previewQuery = (pageId: string) => ({
  queryKey: ['drawing-page', pageId, 'preview'],
  queryFn: ({ signal }: { signal: AbortSignal }) => fetchPagePreview(pageId, signal),
  staleTime: Infinity, // a set's pages never change
  gcTime: 10 * 60_000,
  retry: false, // only a help: the PDF is drawn anyway
})

/** An object URL of the page's picture (null until loaded), and the pages either side fetched
 *  ahead, so moving through a set shows each page at once. */
export function usePagePreview(pageId: string, neighbours: (string | undefined)[] = []): string | null {
  const queryClient = useQueryClient()
  const { data } = useQuery({ ...previewQuery(pageId), enabled: Boolean(pageId) })
  const url = useMemo(() => (data ? URL.createObjectURL(data) : null), [data])
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url])

  const ahead = neighbours.filter(Boolean).join(',')
  useEffect(() => {
    if (!data) return // this page first
    for (const id of ahead.split(',').filter(Boolean)) void queryClient.prefetchQuery(previewQuery(id))
  }, [data, ahead, queryClient])

  return url
}

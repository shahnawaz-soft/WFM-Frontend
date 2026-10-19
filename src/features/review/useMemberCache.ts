import { useQueryClient } from '@tanstack/react-query'

import type { ExtractedMember } from '../../api/types'

/** Keeps the page's member list in the query cache current after a change. */
export function useMemberCache(pageId: string, runId: string | undefined) {
  const queryClient = useQueryClient()
  const key = ['drawing-page', pageId, 'members', runId]
  return {
    replace: (member: ExtractedMember) =>
      queryClient.setQueryData<ExtractedMember[]>(key, (list) => list?.map((m) => (m.id === member.id ? member : m))),
    append: (member: ExtractedMember) =>
      queryClient.setQueryData<ExtractedMember[]>(key, (list) => [...(list ?? []), member]),
    refetch: () => queryClient.invalidateQueries({ queryKey: key }),
  }
}

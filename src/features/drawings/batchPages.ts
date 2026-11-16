import { useQueries } from '@tanstack/react-query'

import type { DrawingPageListItem, DrawingSet, PageBatch } from '../../api/types'
import { pagesQuery } from './queries'
import { kindGroup, repeatedNumbers, sheetLabel, type KindGroup } from './sheets'

/** A batch's pages, in the batch's order, from the drawing sets' page lists. */
export function useBatchPages(sets: DrawingSet[], batch: PageBatch | undefined, showHidden: boolean, kind: KindGroup) {
  const lists = useQueries({ queries: sets.map((set) => pagesQuery(set)) })
  const pages = new Map<string, BatchPageItem>()
  lists.forEach((list, i) => {
    const repeated = repeatedNumbers(list.data ?? [])
    list.data?.forEach((page) => pages.set(page.id, { page, set: sets[i]!, name: sheetLabel(page, repeated) }))
  })
  return (batch?.pages ?? [])
    .flatMap((id) => pages.get(id) ?? [])
    .filter(({ page }) => (showHidden || !page.hidden) && (kind === 'all' || kindGroup(page) === kind))
}

export type BatchPageItem = { page: DrawingPageListItem; set: DrawingSet; name: string }

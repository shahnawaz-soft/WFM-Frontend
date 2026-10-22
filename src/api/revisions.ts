import { apiClient } from './client'
import type { RevisionReport } from './types'

/** What changed between a drawing set and the earlier set it revises. */
export async function getRevision(drawingSetId: string): Promise<RevisionReport> {
  const { data } = await apiClient.get<RevisionReport>(`/api/v1/drawing-sets/${drawingSetId}/revision/`)
  return data
}

/** Say which earlier set this one revises (null: none). */
export async function setRevises(drawingSetId: string, revises: string | null): Promise<void> {
  await apiClient.put(`/api/v1/drawing-sets/${drawingSetId}/revision/`, { revises })
}

/** Pair a revised sheet with an original one (null: it is a new sheet). */
export async function pairSheet(drawingSetId: string, revisedPage: string, originalPage: string | null): Promise<void> {
  await apiClient.post(`/api/v1/drawing-sets/${drawingSetId}/revision/pairs/`, {
    revised_page: revisedPage,
    original_page: originalPage,
  })
}

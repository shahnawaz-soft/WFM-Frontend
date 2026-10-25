import { apiClient } from './client'
import type { components } from './schema'
import type { ProcessingJob } from './types'

type Schemas = components['schemas']

/** Start Run Plan for a page. Returns the already-active job if there is one. */
export async function runPlan(pageId: string, options: { discardReview?: boolean } = {}): Promise<ProcessingJob> {
  const { data } = await apiClient.post<ProcessingJob>(`/api/v1/drawing-pages/${pageId}/run-plan/`, {
    discard_review: options.discardReview ?? false,
  })
  return data
}

/** What "Run all pages" did: page numbers queued now, already running, or skipped (and why). */
export interface SetRunResult {
  queued: number[]
  running: number[]
  skipped: { page: number; reason: string }[]
}

/** Run Plan on every page of a drawing set not run yet (pending or failed pages). */
export async function runAllPages(drawingSetId: string): Promise<SetRunResult> {
  const { data } = await apiClient.post<SetRunResult>(`/api/v1/drawing-sets/${drawingSetId}/run-plan/`)
  return data
}

export async function listPageJobs(pageId: string): Promise<ProcessingJob[]> {
  const { data } = await apiClient.get<ProcessingJob[]>(`/api/v1/drawing-pages/${pageId}/jobs/`)
  return data
}

export type FindSimilarResult = Schemas['FindSimilarResult']

/** A column symbol Steelo missed (PDF points on the page): every mark drawn like it becomes a
 *  column, on this page or (``set``) every plan of its drawing set. */
export async function findSimilarColumns(pageId: string, point: [number, number], scope: 'page' | 'set' = 'page'): Promise<FindSimilarResult> {
  const { data } = await apiClient.post<FindSimilarResult>(`/api/v1/drawing-pages/${pageId}/find-similar-columns/`, { point, scope })
  return data
}

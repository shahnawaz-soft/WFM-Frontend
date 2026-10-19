import { apiClient } from './client'
import type { ProcessingJob } from './types'

/** Start Run Plan for a page. Returns the already-active job if there is one. */
export async function runPlan(pageId: string, options: { discardReview?: boolean } = {}): Promise<ProcessingJob> {
  const { data } = await apiClient.post<ProcessingJob>(`/api/v1/drawing-pages/${pageId}/run-plan/`, {
    discard_review: options.discardReview ?? false,
  })
  return data
}

export async function listPageJobs(pageId: string): Promise<ProcessingJob[]> {
  const { data } = await apiClient.get<ProcessingJob[]>(`/api/v1/drawing-pages/${pageId}/jobs/`)
  return data
}

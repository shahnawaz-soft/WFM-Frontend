import { apiClient } from './client'
import type { components } from './schema'
import type { ProcessingJob, SimilarColumnsJob } from './types'

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

/** A column symbol Steelo missed (PDF points on the page): every mark drawn like it on this page
 *  becomes a column. (Every plan of the set: ``startSimilarColumnsJob``.) */
export async function findSimilarColumns(pageId: string, point: [number, number]): Promise<FindSimilarResult> {
  const { data } = await apiClient.post<FindSimilarResult>(`/api/v1/drawing-pages/${pageId}/find-similar-columns/`, { point, scope: 'page' })
  return data
}

/** The same on every plan of the page's drawing set, as a job a worker runs: poll it with
 *  ``getSimilarColumnsJob``. One search per drawing set at a time: a second start answers 409
 *  ``similar_search_running`` with the running job's id in ``details.job_id``. */
export async function startSimilarColumnsJob(pageId: string, point: [number, number]): Promise<SimilarColumnsJob> {
  const { data } = await apiClient.post<SimilarColumnsJob>(`/api/v1/drawing-pages/${pageId}/find-similar-columns/jobs/`, { point })
  return data
}

export async function getSimilarColumnsJob(jobId: string): Promise<SimilarColumnsJob> {
  const { data } = await apiClient.get<SimilarColumnsJob>(`/api/v1/similar-columns-jobs/${jobId}/`)
  return data
}

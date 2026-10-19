import { apiClient } from './client'
import type { AbmSummary, AbmTotals, DrawingPage, PaginatedAbmEntries } from './types'

/** ABM filters, as sent to GET /projects/:id/abm/ (all optional; lists are comma-separated). */
export interface AbmFilters {
  search?: string
  profile?: string
  designation?: string
  page?: string
  review_status?: string
  source?: string
  match_status?: string
  confidence_lt?: string
  length_min?: string
  length_max?: string
  length_missing?: boolean
  quantity_min?: string
  quantity_max?: string
  include_rejected?: boolean
  /** Every page that has been run, not only those added to the project (not a final figure). */
  draft?: boolean
  ordering?: string
  limit?: number
  offset?: number
}

export async function listAbm(projectId: string, filters: AbmFilters): Promise<PaginatedAbmEntries> {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== '' && v !== false))
  const { data } = await apiClient.get<PaginatedAbmEntries>(`/api/v1/projects/${projectId}/abm/`, { params })
  return data
}

export async function getAbmSummary(projectId: string, draft = false): Promise<AbmSummary> {
  const { data } = await apiClient.get<AbmSummary>(`/api/v1/projects/${projectId}/abm/summary/`, {
    params: draft ? { draft: true } : undefined,
  })
  return data
}

/** The draft ABM (every page that has been run, before review) as an Excel workbook. */
export async function downloadDraftAbm(projectId: string, filename: string): Promise<void> {
  const { data } = await apiClient.get<Blob>(`/api/v1/projects/${projectId}/abm/draft-export/`, { responseType: 'blob' })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function addPageToProject(pageId: string): Promise<DrawingPage> {
  const { data } = await apiClient.post<DrawingPage>(`/api/v1/drawing-pages/${pageId}/add-to-project/`)
  return data
}

export async function removePageFromProject(pageId: string, reason = ''): Promise<DrawingPage> {
  const { data } = await apiClient.post<DrawingPage>(`/api/v1/drawing-pages/${pageId}/remove-from-project/`, { reason })
  return data
}

export async function getAbmTotals(projectId: string, draft = false): Promise<AbmTotals> {
  const { data } = await apiClient.get<AbmTotals>(`/api/v1/projects/${projectId}/abm/totals/`, {
    params: draft ? { draft: true } : undefined,
  })
  return data
}

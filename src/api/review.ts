import { apiClient } from './client'
import type { FinalizeCheck, HistoryCategory, OutputVersion, ProjectHistory, ProjectSummary } from './types'

export async function getProjectSummary(projectId: string): Promise<ProjectSummary> {
  const { data } = await apiClient.get<ProjectSummary>(`/api/v1/projects/${projectId}/summary/`)
  return data
}

export async function getProjectHistory(
  projectId: string,
  params: { before?: string; category?: HistoryCategory | ''; limit?: number } = {},
): Promise<ProjectHistory> {
  const query = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''))
  const { data } = await apiClient.get<ProjectHistory>(`/api/v1/projects/${projectId}/history/`, { params: query })
  return data
}

export async function getFinalizeCheck(projectId: string): Promise<FinalizeCheck> {
  const { data } = await apiClient.get<FinalizeCheck>(`/api/v1/projects/${projectId}/finalize/`)
  return data
}

export async function finalizeProject(projectId: string, acknowledgeExceptions: boolean, note: string): Promise<OutputVersion> {
  const { data } = await apiClient.post<OutputVersion>(`/api/v1/projects/${projectId}/finalize/`, {
    acknowledge_exceptions: acknowledgeExceptions,
    note,
  })
  return data
}

export async function reopenProject(projectId: string, reason: string): Promise<void> {
  await apiClient.post(`/api/v1/projects/${projectId}/reopen/`, { reason })
}

export async function listOutputVersions(projectId: string): Promise<OutputVersion[]> {
  const { data } = await apiClient.get<OutputVersion[]>(`/api/v1/projects/${projectId}/outputs/`)
  return data
}

export type OutputFormat = 'xlsx' | 'json' | 'ifc'

/** Downloads a finalised version (Excel, the JSON snapshot, or an IFC4 model for Tekla) as a file. */
export async function downloadOutput(versionId: string, format: OutputFormat, filename: string): Promise<void> {
  const { data } = await apiClient.get<Blob>(`/api/v1/outputs/${versionId}/download/`, {
    params: { format },
    responseType: 'blob',
  })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

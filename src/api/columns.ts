import { apiClient } from './client'
import type { ColumnSchedule, ColumnSyncResult } from './types'

export async function getColumnSchedule(projectId: string): Promise<ColumnSchedule> {
  const { data } = await apiClient.get<ColumnSchedule>(`/api/v1/projects/${projectId}/column-schedule/`)
  return data
}

/** Bring the ABM in line with the schedule (heights, symbol-only columns). */
export async function syncColumns(projectId: string): Promise<ColumnSyncResult> {
  const { data } = await apiClient.post<ColumnSyncResult>(`/api/v1/projects/${projectId}/column-schedule/sync/`)
  return data
}

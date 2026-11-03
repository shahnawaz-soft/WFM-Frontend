import { apiClient } from './client'
import type { ColumnMarks, ColumnSchedule, ColumnSyncResult } from './types'

export async function getColumnSchedule(projectId: string): Promise<ColumnSchedule> {
  const { data } = await apiClient.get<ColumnSchedule>(`/api/v1/projects/${projectId}/column-schedule/`)
  return data
}

/** Bring the ABM in line with the schedule (heights, symbol-only columns). */
export async function syncColumns(projectId: string): Promise<ColumnSyncResult> {
  const { data } = await apiClient.post<ColumnSyncResult>(`/api/v1/projects/${projectId}/column-schedule/sync/`)
  return data
}

/** The project's column marks: how many columns each names on the plans, a schedule's section,
 *  the one a person entered, and the schedule sheets the notes name that the project lacks. */
export async function getColumnMarks(projectId: string): Promise<ColumnMarks> {
  const { data } = await apiClient.get<ColumnMarks>(`/api/v1/projects/${projectId}/column-marks/`)
  return data
}

/** Enter each mark's section ("" clears it): every column with the mark takes it. */
export async function setColumnMarks(projectId: string, sizes: Record<string, string>): Promise<ColumnMarks> {
  const { data } = await apiClient.post<ColumnMarks>(`/api/v1/projects/${projectId}/column-marks/`, { sizes })
  return data
}

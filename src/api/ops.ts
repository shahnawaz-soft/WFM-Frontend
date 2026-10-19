import { apiClient } from './client'
import type { OpsAuditPage, OpsJobPage } from './types'

export interface OpsOverview {
  healthy: boolean
  checks: Record<string, string>
  jobs_24h: Record<string, number>
  active_jobs: number
  oldest_active_seconds: number | null
  average_run_seconds_7d: number | null
  failures_7d: { error_code: string; n: number }[]
  wireframes: { generating: number; failed_7d: number }
  engines: { engine_name: string; engine_version: string; pages: number }[]
  corrections_7d: number
  rejections_7d: number
}

const clean = (params: object) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== undefined))

export async function getOpsOverview(): Promise<OpsOverview> {
  const { data } = await apiClient.get<OpsOverview>('/api/v1/ops/overview/')
  return data
}

export async function listOpsJobs(params: { status?: string; search?: string; offset?: number; limit?: number }): Promise<OpsJobPage> {
  const { data } = await apiClient.get<OpsJobPage>('/api/v1/ops/jobs/', { params: clean(params) })
  return data
}

export async function listOpsAudit(params: { action?: string; search?: string; offset?: number; limit?: number }): Promise<OpsAuditPage> {
  const { data } = await apiClient.get<OpsAuditPage>('/api/v1/ops/audit/', { params: clean(params) })
  return data
}

export interface OpsMetrics {
  days: number
  events: { key: string; label: string; count: number }[]
  north_star: {
    median_hours_upload_to_abm_started: number | null
    median_hours_upload_to_finalised: number | null
    median_hours_upload_to_reviewed_wireframe: number | null
    projects_measured: number
  }
  completion: { projects_started: number; projects_finalised: number; rate: number | null; target: number }
  review: { median_minutes_run_to_page_reviewed: number | null }
  quality: {
    members_extracted: number
    corrections_per_100_members: number | null
    rejections_per_100_members: number | null
    extraction_failure_rate: number | null
    processing_coverage: number | null
    processing_coverage_target: number
  }
  weeks: { week_start: string; uploads: number; pages_processed: number; corrections: number; finalised: number }[]
  notes: string[]
}

export async function getOpsMetrics(days: number): Promise<OpsMetrics> {
  const { data } = await apiClient.get<OpsMetrics>('/api/v1/ops/metrics/', { params: { days } })
  return data
}

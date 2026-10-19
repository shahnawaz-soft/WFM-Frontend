import { apiClient } from './client'

export type CheckStatus = 'ok' | 'error'

export interface HealthStatus {
  status: CheckStatus
  version: string
  checks?: Record<string, CheckStatus>
}

/**
 * Backend readiness. A 503 still carries a normal body saying which dependency is down,
 * so it is treated as data, not as a request failure.
 */
export async function fetchReadiness(): Promise<HealthStatus> {
  const { data } = await apiClient.get<HealthStatus>('/health/ready', {
    validateStatus: (status) => status === 200 || status === 503,
  })
  return data
}

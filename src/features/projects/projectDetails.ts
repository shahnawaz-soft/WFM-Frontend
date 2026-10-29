import type { Project } from '../../api/types'

export type ProjectDetails = Pick<Project, 'client_name' | 'team_name' | 'tekla_version'> & {
  /** yyyy-mm-dd as the date input gives it; '' = none. */
  target_completion_date: string
}

export const NO_DETAILS: ProjectDetails = { client_name: '', team_name: '', tekla_version: '', target_completion_date: '' }

export const detailsOf = (project: Project): ProjectDetails => ({
  client_name: project.client_name,
  team_name: project.team_name,
  tekla_version: project.tekla_version,
  target_completion_date: project.target_completion_date ?? '',
})

/** What the API takes: trimmed text, and null for no target date. */
export const detailsPayload = (d: ProjectDetails) => ({
  client_name: d.client_name.trim(),
  team_name: d.team_name.trim(),
  tekla_version: d.tekla_version.trim(),
  target_completion_date: d.target_completion_date || null,
})

/** A yyyy-mm-dd date as "15 Dec 2026" (read as a calendar date, not a UTC instant). */
export function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y!, m! - 1, d!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

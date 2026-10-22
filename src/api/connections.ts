import { apiClient } from './client'
import type { ConnectionKind, ConnectionLine, ConnectionList, ConnectionTemplate } from './types'

export interface ConnectionLineInput {
  kind: ConnectionKind
  description: string
  length?: string
  spacing?: string
  quantity?: number
  grade?: string
  finish?: string
}

export type ConnectionScope = 'entry' | 'page' | 'project'

export async function listConnectionMaterial(projectId: string, memberId?: string): Promise<ConnectionList> {
  const { data } = await apiClient.get<ConnectionList>(`/api/v1/projects/${projectId}/connection-material/`, {
    params: memberId ? { member: memberId } : {},
  })
  return data
}

/** Lines typed in, or a template's lines, on the given entries (and their section's, by scope). */
export async function addConnectionMaterial(
  projectId: string,
  members: string[],
  what: { lines: ConnectionLineInput[] } | { template: string },
  scope: ConnectionScope = 'entry',
): Promise<ConnectionLine[]> {
  const { data } = await apiClient.post<ConnectionLine[]>(`/api/v1/projects/${projectId}/connection-material/`, {
    members,
    scope,
    ...what,
  })
  return data
}

export async function editConnectionMaterial(line: ConnectionLine, changes: ConnectionLineInput): Promise<ConnectionLine> {
  const { data } = await apiClient.patch<ConnectionLine>(`/api/v1/connection-material/${line.id}/`, {
    version: line.version,
    ...changes,
  })
  return data
}

export async function removeConnectionMaterial(line: ConnectionLine): Promise<void> {
  await apiClient.delete(`/api/v1/connection-material/${line.id}/`, { data: { version: line.version } })
}

export interface TemplateInput {
  name: string
  note?: string
  lines: ConnectionLineInput[]
}

export async function listTemplates(): Promise<ConnectionTemplate[]> {
  const { data } = await apiClient.get<ConnectionTemplate[]>('/api/v1/connection-templates/')
  return data
}

export async function createTemplate(input: TemplateInput): Promise<ConnectionTemplate> {
  const { data } = await apiClient.post<ConnectionTemplate>('/api/v1/connection-templates/', input)
  return data
}

export async function editTemplate(template: ConnectionTemplate, changes: Partial<TemplateInput>): Promise<ConnectionTemplate> {
  const { data } = await apiClient.patch<ConnectionTemplate>(`/api/v1/connection-templates/${template.id}/`, {
    version: template.version,
    ...changes,
  })
  return data
}

export async function deleteTemplate(template: ConnectionTemplate): Promise<void> {
  await apiClient.delete(`/api/v1/connection-templates/${template.id}/`, { data: { version: template.version } })
}

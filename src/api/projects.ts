import { apiClient } from './client'
import type { Membership, PaginatedProjects, Project, ProjectRole, UserLookup } from './types'

export interface ProjectFilters {
  search?: string
  status?: 'current' | 'active' | 'finalized' | 'archived' | 'all'
  limit: number
  offset: number
}

const base = '/api/v1/projects/'

export async function listProjects(filters: ProjectFilters): Promise<PaginatedProjects> {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== '' && v != null))
  const { data } = await apiClient.get<PaginatedProjects>(base, { params })
  return data
}

export async function getProject(id: string): Promise<Project> {
  const { data } = await apiClient.get<Project>(`${base}${id}/`)
  return data
}

export async function createProject(name: string): Promise<Project> {
  const { data } = await apiClient.post<Project>(base, { name })
  return data
}

export async function renameProject(id: string, name: string, version: number): Promise<Project> {
  const { data } = await apiClient.patch<Project>(`${base}${id}/`, { name, version })
  return data
}

export async function setArchived(id: string, archived: boolean, version: number): Promise<Project> {
  const { data } = await apiClient.post<Project>(`${base}${id}/${archived ? 'archive' : 'restore'}/`, {
    version,
  })
  return data
}

export async function listMembers(projectId: string): Promise<Membership[]> {
  const { data } = await apiClient.get<Membership[]>(`${base}${projectId}/members/`)
  return data
}

export async function addMember(projectId: string, userId: string, role: ProjectRole): Promise<Membership> {
  const { data } = await apiClient.post<Membership>(`${base}${projectId}/members/`, { user_id: userId, role })
  return data
}

export async function changeMemberRole(projectId: string, membershipId: string, role: ProjectRole) {
  const { data } = await apiClient.patch<Membership>(`${base}${projectId}/members/${membershipId}/`, { role })
  return data
}

export async function removeMember(projectId: string, membershipId: string): Promise<void> {
  await apiClient.delete(`${base}${projectId}/members/${membershipId}/`)
}

export async function lookupUsers(search: string): Promise<UserLookup[]> {
  const { data } = await apiClient.get<UserLookup[]>('/api/v1/users/lookup/', { params: { search } })
  return data
}

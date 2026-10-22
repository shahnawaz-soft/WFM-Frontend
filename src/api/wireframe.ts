import { apiClient } from './client'
import type { DrawingPage, LevelProposals, Wireframe, WireframeElement, WireframeSetup } from './types'

export interface LevelChanges {
  level_label?: string
  /** As typed: 14'-0", 0, -10', 4267 mm. Blank clears it. */
  elevation?: string
  reference_point?: [number, number] | null
  reference_label?: string
}

export async function setPageLevel(pageId: string, changes: LevelChanges): Promise<DrawingPage> {
  const { data } = await apiClient.patch<DrawingPage>(`/api/v1/drawing-pages/${pageId}/level/`, changes)
  return data
}

export async function getWireframeSetup(projectId: string): Promise<WireframeSetup> {
  const { data } = await apiClient.get<WireframeSetup>(`/api/v1/projects/${projectId}/wireframe-setup/`)
  return data
}

export async function listWireframes(projectId: string): Promise<Wireframe[]> {
  const { data } = await apiClient.get<Wireframe[]>(`/api/v1/projects/${projectId}/wireframes/`)
  return data
}

/** ``draft``: build from every page that has been run, not only pages added to the project. */
export async function generateWireframe(projectId: string, options: { draft?: boolean } = {}): Promise<Wireframe> {
  const { data } = await apiClient.post<Wireframe>(`/api/v1/projects/${projectId}/wireframes/`, {
    draft: options.draft ?? false,
  })
  return data
}

export async function listWireframeElements(wireframeId: string): Promise<WireframeElement[]> {
  const { data } = await apiClient.get<WireframeElement[]>(`/api/v1/wireframes/${wireframeId}/elements/`)
  return data
}

/** Coordinates: numbers (mm) or text in feet-inches / mm, e.g. "14'-0\"". */
export type Point = [number | string, number | string, number | string]

export interface ElementChanges {
  element_type?: 'beam' | 'column'
  designation?: string
  level_label?: string
  start?: Point
  end?: Point
  reason?: string
}

export async function editElement(id: string, version: number, changes: ElementChanges): Promise<WireframeElement> {
  const { data } = await apiClient.patch<WireframeElement>(`/api/v1/wireframe-elements/${id}/`, { version, ...changes })
  return data
}

export async function addElement(
  wireframeId: string,
  element: Required<Pick<ElementChanges, 'element_type' | 'start' | 'end'>> & ElementChanges,
): Promise<WireframeElement> {
  const { data } = await apiClient.post<WireframeElement>(`/api/v1/wireframes/${wireframeId}/elements/`, element)
  return data
}

export async function removeElement(id: string, version: number, reason = ''): Promise<void> {
  await apiClient.delete(`/api/v1/wireframe-elements/${id}/`, { data: { version, reason } })
}

export async function markWireframeReviewed(wireframeId: string, note = ''): Promise<Wireframe> {
  const { data } = await apiClient.post<Wireframe>(`/api/v1/wireframes/${wireframeId}/mark-reviewed/`, { note })
  return data
}

export async function copyWireframe(wireframeId: string): Promise<Wireframe> {
  const { data } = await apiClient.post<Wireframe>(`/api/v1/wireframes/${wireframeId}/copy/`)
  return data
}

/** Each plan's level, elevation and reference grid point as read from the drawings (OD-10). */
export async function getLevelProposals(projectId: string): Promise<LevelProposals> {
  const { data } = await apiClient.get<LevelProposals>(`/api/v1/projects/${projectId}/level-proposals/`)
  return data
}

/** Set the proposed values on these pages (audited, as when typed). */
export async function applyLevelProposals(projectId: string, pages: string[]): Promise<{ applied: number }> {
  const { data } = await apiClient.post<{ applied: number }>(`/api/v1/projects/${projectId}/level-proposals/apply/`, { pages })
  return data
}

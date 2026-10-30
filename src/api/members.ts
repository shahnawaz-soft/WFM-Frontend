import { apiClient } from './client'
import type { DrawingPage, ExtractedMember, ExtractionIssue, MemberRevision, ReviewStatus } from './types'

export async function listPageMembers(pageId: string): Promise<ExtractedMember[]> {
  const { data } = await apiClient.get<ExtractedMember[]>(`/api/v1/drawing-pages/${pageId}/members/`)
  return data
}

export async function listPageIssues(pageId: string): Promise<ExtractionIssue[]> {
  const { data } = await apiClient.get<ExtractionIssue[]>(`/api/v1/drawing-pages/${pageId}/issues/`)
  return data
}

export async function getMember(id: string): Promise<ExtractedMember> {
  const { data } = await apiClient.get<ExtractedMember>(`/api/v1/members/${id}/`)
  return data
}

export interface MemberChanges {
  designation?: string
  mark?: string
  member_type?: string
  /** As typed: 24'-3", 291", 7391 mm… Blank clears the length. */
  length?: string
  quantity?: number
  /** Shear studs: 44, or by segment 36, 4, 4, 40. Blank clears them. */
  studs?: string
  /** Camber in inches: 3/4", 1 1/2", 0.75. Blank clears it. */
  camber?: string
}

export async function editMember(id: string, version: number, changes: MemberChanges, reason = '') {
  const { data } = await apiClient.patch<ExtractedMember>(`/api/v1/members/${id}/`, { version, reason, ...changes })
  return data
}

export async function reviewMember(id: string, version: number, status: ReviewStatus, reason = '') {
  const { data } = await apiClient.post<ExtractedMember>(`/api/v1/members/${id}/review/`, { version, status, reason })
  return data
}

/** The same review status and/or changes for several members of a page, all or nothing. */
export async function reviewMembers(
  pageId: string,
  members: Pick<ExtractedMember, 'id' | 'version'>[],
  action: { status?: ReviewStatus; changes?: Omit<MemberChanges, 'mark'>; reason?: string },
): Promise<ExtractedMember[]> {
  const { data } = await apiClient.post<ExtractedMember[]>(`/api/v1/drawing-pages/${pageId}/members/bulk/`, {
    members: members.map(({ id, version }) => ({ id, version })),
    ...action,
  })
  return data
}

export async function restoreMember(id: string, version: number) {
  const { data } = await apiClient.post<ExtractedMember>(`/api/v1/members/${id}/restore/`, { version })
  return data
}

export async function memberHistory(id: string): Promise<MemberRevision[]> {
  const { data } = await apiClient.get<MemberRevision[]>(`/api/v1/members/${id}/history/`)
  return data
}

export async function addManualMember(
  pageId: string,
  input: MemberChanges & { location?: [number, number] | null; reason?: string },
) {
  const { data } = await apiClient.post<ExtractedMember>(`/api/v1/drawing-pages/${pageId}/members/`, input)
  return data
}

export async function acceptAllOpen(pageId: string): Promise<{ accepted: number }> {
  const { data } = await apiClient.post<{ accepted: number }>(`/api/v1/drawing-pages/${pageId}/accept-all/`)
  return data
}

export async function markPageReviewed(pageId: string): Promise<DrawingPage> {
  const { data } = await apiClient.post<DrawingPage>(`/api/v1/drawing-pages/${pageId}/mark-reviewed/`)
  return data
}

export async function reopenPageReview(pageId: string, reason = ''): Promise<DrawingPage> {
  const { data } = await apiClient.post<DrawingPage>(`/api/v1/drawing-pages/${pageId}/reopen-review/`, { reason })
  return data
}

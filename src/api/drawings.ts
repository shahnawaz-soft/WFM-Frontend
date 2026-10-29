import { apiClient } from './client'
import type { DrawingPage, DrawingPageListItem, DrawingSet, PageBatch, UploadLimits } from './types'

export async function getUploadLimits(): Promise<UploadLimits> {
  const { data } = await apiClient.get<UploadLimits>('/api/v1/drawing-sets/limits/')
  return data
}

export async function listDrawingSets(projectId: string): Promise<DrawingSet[]> {
  const { data } = await apiClient.get<DrawingSet[]>(`/api/v1/projects/${projectId}/drawing-sets/`)
  return data
}

export async function listPages(drawingSetId: string): Promise<DrawingPageListItem[]> {
  const { data } = await apiClient.get<DrawingPageListItem[]>(`/api/v1/drawing-sets/${drawingSetId}/pages/`)
  return data
}

export async function uploadDrawingSet(
  projectId: string,
  file: File,
  options: { confirmDuplicate?: boolean; revises?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<DrawingSet> {
  const form = new FormData()
  form.append('file', file)
  form.append('confirm_duplicate', options.confirmDuplicate ? 'true' : 'false')
  if (options.revises) form.append('revises', options.revises)
  const { data } = await apiClient.post<DrawingSet>(`/api/v1/projects/${projectId}/drawing-sets/`, form, {
    signal: options.signal,
    timeout: 0, // large uploads: progress is shown; the user can cancel
    onUploadProgress: (event) => {
      if (event.total) options.onProgress?.(event.loaded / event.total)
    },
  })
  return data
}

export async function retryDrawingSet(drawingSetId: string): Promise<DrawingSet> {
  const { data } = await apiClient.post<DrawingSet>(`/api/v1/drawing-sets/${drawingSetId}/retry/`)
  return data
}

/** Files need the Authorization header, so they are fetched as blobs (never public URLs). */
export async function fetchThumbnail(pageId: string, signal?: AbortSignal): Promise<Blob> {
  const { data } = await apiClient.get<Blob>(`/api/v1/drawing-pages/${pageId}/thumbnail/`, {
    responseType: 'blob',
    signal,
  })
  return data
}

export async function downloadOriginal(drawingSet: DrawingSet): Promise<void> {
  const { data } = await apiClient.get<Blob>(`/api/v1/drawing-sets/${drawingSet.id}/file/`, {
    responseType: 'blob',
    timeout: 0,
  })
  const url = URL.createObjectURL(data)
  const link = document.createElement('a')
  link.href = url
  link.download = drawingSet.original_filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Remove a drawing set from its project (soft: the file and history are kept). */
export async function listBatches(projectId: string): Promise<PageBatch[]> {
  const { data } = await apiClient.get<PageBatch[]>(`/api/v1/projects/${projectId}/batches/`)
  return data
}

export async function createBatch(projectId: string, name: string): Promise<PageBatch> {
  const { data } = await apiClient.post<PageBatch>(`/api/v1/projects/${projectId}/batches/`, { name })
  return data
}

/** Put pages in a batch in this order (``batch`` null: out of every batch). */
export async function arrangePages(projectId: string, batch: string | null, pageIds: string[]): Promise<PageBatch[]> {
  const { data } = await apiClient.post<PageBatch[]>(`/api/v1/projects/${projectId}/batches/arrange/`, {
    batch,
    pages: pageIds,
  })
  return data
}

export async function renameBatch(batchId: string, name: string): Promise<PageBatch> {
  const { data } = await apiClient.patch<PageBatch>(`/api/v1/batches/${batchId}/`, { name })
  return data
}

export async function deleteBatch(batchId: string): Promise<void> {
  await apiClient.delete(`/api/v1/batches/${batchId}/`)
}

/** A person's name for the sheet ('' = the name read from the drawing). */
export async function nameSheet(pageId: string, name: string): Promise<DrawingPage> {
  const { data } = await apiClient.post<DrawingPage>(`/api/v1/drawing-pages/${pageId}/sheet-name/`, { name })
  return data
}

/** Hide pages of the project (or show them again with ``hidden: false``). */
export async function hidePages(projectId: string, pageIds: string[], hidden: boolean): Promise<{ updated: number }> {
  const { data } = await apiClient.post<{ updated: number }>(`/api/v1/projects/${projectId}/pages/hide/`, {
    pages: pageIds,
    hidden,
  })
  return data
}

export async function removeDrawingSet(drawingSetId: string): Promise<void> {
  await apiClient.delete(`/api/v1/drawing-sets/${drawingSetId}/`)
}

export async function getDrawingSet(drawingSetId: string): Promise<DrawingSet> {
  const { data } = await apiClient.get<DrawingSet>(`/api/v1/drawing-sets/${drawingSetId}/`)
  return data
}

export async function getPage(pageId: string): Promise<DrawingPage> {
  const { data } = await apiClient.get<DrawingPage>(`/api/v1/drawing-pages/${pageId}/`)
  return data
}

/** The original PDF bytes (authenticated), for rendering in the page viewer. */
export async function fetchOriginalPdf(
  drawingSetId: string,
  onProgress?: (loaded: number, total: number | undefined) => void,
): Promise<ArrayBuffer> {
  const { data } = await apiClient.get<ArrayBuffer>(`/api/v1/drawing-sets/${drawingSetId}/file/`, {
    responseType: 'arraybuffer',
    timeout: 0,
    onDownloadProgress: (event) => onProgress?.(event.loaded, event.total),
  })
  return data
}

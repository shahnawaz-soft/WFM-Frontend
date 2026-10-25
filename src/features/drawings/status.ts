import type { DrawingSet, PageStatus, ProcessingJob, UploadLimits } from '../../api/types'
import type { StatusTone } from '../../components/ui/StatusIcon'

export const PAGE_STATUS: Record<PageStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Pending', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  processed: { label: 'Processed', tone: 'info' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  added: { label: 'Added', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
}

export function drawingSetStatus(set: DrawingSet): { label: string; tone: StatusTone } {
  if (set.status === 'processing') return { label: `Preparing pages (${set.pages_ready}/${set.page_count})`, tone: 'info' }
  if (set.status === 'failed') return { label: set.error_code === 'ingest_timed_out' ? 'Timed out' : 'Failed', tone: 'error' }
  if (set.pages_failed > 0) {
    return { label: `Ready — ${set.pages_failed} ${set.pages_failed === 1 ? 'page' : 'pages'} failed`, tone: 'warning' }
  }
  return { label: 'Ready', tone: 'success' }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Fast client-side check; the server validates again (type, signature, pages, password). */
export function precheck(file: File, limits: UploadLimits): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!limits.allowed_extensions.includes(extension)) {
    return `“${file.name}” is not a supported file. Supported: ${limits.allowed_extensions
      .map((e) => `.${e}`)
      .join(', ')}.`
  }
  if (file.size > limits.max_upload_mb * 1024 * 1024) {
    return `“${file.name}” is ${formatBytes(file.size)}; the limit is ${limits.max_upload_mb} MB. Split the drawing set and upload the parts.`
  }
  return null
}

export const JOB_STATUS: Record<import('../../api/types').JobStatus, { label: string; tone: StatusTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  processing: { label: 'Processing', tone: 'info' },
  completed: { label: 'Completed', tone: 'success' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  failed: { label: 'Failed', tone: 'error' },
}

/** A job's status; a failed job that ran out of time (error code ``timed_out``) says so. */
export function jobStatus(job: Pick<ProcessingJob, 'status' | 'error_code'>): { label: string; tone: StatusTone } {
  if (job.status === 'failed' && job.error_code === 'timed_out') return { label: 'Timed out', tone: 'error' }
  return JOB_STATUS[job.status]
}

export const PAGE_KIND_LABELS: Record<import('../../api/types').PageKind, string> = {
  vector: 'Vector drawing',
  raster: 'Scanned image',
  mixed: 'Vector drawing with images',
  empty: 'Blank page',
}

export function isActiveJob(job: { status: string } | null | undefined): boolean {
  return job?.status === 'queued' || job?.status === 'processing'
}

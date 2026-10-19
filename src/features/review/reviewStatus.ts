import type { ReviewStatus } from '../../api/types'
import type { StatusTone } from '../../components/ui/StatusIcon'

export const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: StatusTone }> = {
  unreviewed: { label: 'To review', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'error' },
  needs_review: { label: 'Needs review', tone: 'warning' },
  unsupported: { label: 'Unsupported', tone: 'warning' },
}

export const OPEN_STATUSES: ReviewStatus[] = ['unreviewed', 'needs_review']

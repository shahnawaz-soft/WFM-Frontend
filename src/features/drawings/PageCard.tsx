import { Link } from 'react-router'

import { toApiError } from '../../api/errors'
import type { DrawingPageListItem } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { PageResult } from './PageResult'
import { PAGE_STATUS } from './status'
import { Thumbnail } from './Thumbnail'
import { usePageRun } from './usePageRun'

interface PageCardProps {
  page: DrawingPageListItem
  projectId: string
  setName: string
  canRun: boolean
}

export function PageCard({ page, projectId, setName, canRun }: PageCardProps) {
  const { action, mutation, confirmDialog } = usePageRun(page, canRun)
  const pageStatus = PAGE_STATUS[page.status]

  return (
    <li className="page-card" data-status={page.status} aria-label={`Page ${page.page_number}`}>
      <Link
        to={`/projects/${projectId}/pages/${page.id}`}
        className="page-card__open"
        aria-label={`Open page ${page.page_number} of ${setName}`}
      >
        <Thumbnail page={page} alt="" />
      </Link>
      <div className="page-card__footer">
        <span className="page-card__number">Page {page.page_number}</span>
        <StatusBadge tone={pageStatus.tone} label={pageStatus.label} />
      </div>

      <div className="page-card__body">
        {page.error_message && <p className="page-card__error">{page.error_message}</p>}
        <PageResult page={page} />
        {mutation.error && <p className="page-card__error">{toApiError(mutation.error).message}</p>}
        {action && (
          <Button
            variant={action.label === 'Run again' ? 'secondary' : 'primary'}
            loading={mutation.isPending}
            onClick={action.onClick}
            aria-label={`${action.label} — page ${page.page_number}`}
            className="button--block"
          >
            {action.label}
          </Button>
        )}
      </div>
      {confirmDialog}
    </li>
  )
}

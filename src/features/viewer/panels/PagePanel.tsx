import { toApiError } from '../../../api/errors'
import type { DrawingPage } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import { PageResult } from '../../drawings/PageResult'
import { PAGE_KIND_LABELS, PAGE_STATUS } from '../../drawings/status'
import { usePageRun } from '../../drawings/usePageRun'

const SHEET_KIND_LABELS: Record<string, string> = {
  plan: 'Plan',
  elevation: 'Elevation',
  section: 'Sections',
  detail: 'Details',
  schedule: 'Schedule',
  notes: 'Notes',
}

export function PagePanel({ page, canRun }: { page: DrawingPage; canRun: boolean }) {
  const { action, mutation, confirmDialog } = usePageRun(page, canRun)
  const status = PAGE_STATUS[page.status]
  const run = page.current_run
  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Page</h2>
      </div>
      <p>
        Status: <StatusBadge tone={status.tone} label={status.label} />
      </p>
      {page.width_pt && page.height_pt && (
        <p className="muted">
          Sheet {Math.round((page.width_pt / 72) * 25.4)} × {Math.round((page.height_pt / 72) * 25.4)} mm
          {page.rotation ? ` · rotated ${page.rotation}°` : ''}
        </p>
      )}
      {page.error_message && <p className="page-card__error">{page.error_message}</p>}
      <PageResult page={page} showReasons={false} />
      {run && (
        <dl className="facts">
          <dt>Content</dt>
          <dd>{PAGE_KIND_LABELS[run.page_kind]}</dd>
          {run.summary.sheet_kind && run.summary.sheet_kind !== 'unknown' && (
            <>
              <dt>Sheet</dt>
              <dd>
                {SHEET_KIND_LABELS[run.summary.sheet_kind]}
                {!['plan', 'notes'].includes(run.summary.sheet_kind) && <span className="muted"> · members taken from plans only</span>}
              </dd>
            </>
          )}
          <dt>Vector lines</dt>
          <dd>{run.summary.paths.toLocaleString()}</dd>
          <dt>Text characters</dt>
          <dd>{run.summary.text_chars.toLocaleString()}</dd>
          <dt>Engine</dt>
          <dd>
            {run.engine_name} {run.engine_version}
          </dd>
        </dl>
      )}
      {mutation.error && <p className="page-card__error">{toApiError(mutation.error).message}</p>}
      {action && (
        <Button
          variant={action.label === 'Run again' ? 'secondary' : 'primary'}
          loading={mutation.isPending}
          onClick={action.onClick}
          className="button--block"
        >
          {action.label}
        </Button>
      )}
      {!page.latest_job && !action && <p className="muted">This page has not been processed yet.</p>}
      {confirmDialog}
    </div>
  )
}

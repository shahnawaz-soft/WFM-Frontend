import { toApiError } from '../../../api/errors'
import type { DrawingPageListItem, ExtractionRun } from '../../../api/types'
import { LoadingState } from '../../../components/feedback/States'
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

/** ``page`` may be the page list's item (status, latest job, slim run); ``run`` is the page
 *  detail's run (Step B): null = no run, undefined = the detail is loading. */
export function PagePanel({ page, run, canRun }: { page: DrawingPageListItem; run: ExtractionRun | null | undefined; canRun: boolean }) {
  const { action, mutation, confirmDialog } = usePageRun(page, canRun)
  const status = PAGE_STATUS[page.status]
  // Summary keys are optional: older runs may lack some.
  const sheetKind = run?.summary?.sheet_kind
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
      {page.current_run && run === undefined && <LoadingState label="Loading the page analysis…" />}
      {run && (
        <dl className="facts">
          <dt>Content</dt>
          <dd>{PAGE_KIND_LABELS[run.page_kind]}</dd>
          {sheetKind && sheetKind !== 'unknown' && (
            <>
              <dt>Sheet</dt>
              <dd>
                {SHEET_KIND_LABELS[sheetKind]}
                {!['plan', 'notes'].includes(sheetKind) && <span className="muted"> · members taken from plans only</span>}
              </dd>
            </>
          )}
          <dt>Vector lines</dt>
          <dd>{run.summary?.paths?.toLocaleString() ?? '—'}</dd>
          <dt>Text characters</dt>
          <dd>{run.summary?.text_chars?.toLocaleString() ?? '—'}</dd>
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

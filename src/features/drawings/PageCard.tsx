import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { nameSheet } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import type { DrawingPageListItem } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import type { PageSelection } from './DrawingsSection'
import { SHEET_KIND_LABELS } from './sheets'
import { isActiveJob, JOB_STATUS, PAGE_STATUS } from './status'
import { Thumbnail } from './Thumbnail'
import { usePageRun } from './usePageRun'

interface PageCardProps {
  page: DrawingPageListItem
  projectId: string
  setName: string
  canRun: boolean
  /** Set while the person is ticking pages (to hide them). */
  selection?: PageSelection
  /** What the sheet is called ("S302 · THIRD FLOOR FRAMING PLAN"); '' when unknown. */
  sheetName?: string
  /** In a batch: move the page one place earlier or later. */
  move?: { earlier?: () => void; later?: () => void; pending: boolean }
}

export function PageCard({ page, projectId, setName, canRun, selection, move, sheetName = '' }: PageCardProps) {
  const [renaming, setRenaming] = useState(false)
  const kind = page.current_run?.sheet_kind ? SHEET_KIND_LABELS[page.current_run.sheet_kind] : undefined
  const { action, mutation, confirmDialog } = usePageRun(page, canRun)
  const pageStatus = PAGE_STATUS[page.status]

  return (
    <li className="page-card" data-status={page.status} data-hidden={page.hidden || undefined} aria-label={`Page ${page.page_number}`}>
      {selection && (
        <label className="page-card__select">
          <input
            type="checkbox"
            checked={selection.selected.has(page.id)}
            onChange={() => selection.toggle(page.id)}
            aria-label={`Select page ${page.page_number} of ${setName}`}
          />
        </label>
      )}
      <Link
        to={`/projects/${projectId}/pages/${page.id}`}
        className="page-card__open"
        aria-label={`Open page ${page.page_number} of ${setName}`}
      >
        <Thumbnail page={page} alt="" />
      </Link>
      {sheetName && (
        <p className="page-card__sheet" title={sheetName}>
          {sheetName}
        </p>
      )}
      {renaming && <SheetNameDialog page={page} current={sheetName} onClose={() => setRenaming(false)} />}
      <div className="page-card__footer">
        <span className="page-card__number">Page {page.page_number}</span>
        {canRun && (
          <button
            type="button"
            className="link-button page-card__rename"
            onClick={() => setRenaming(true)}
            aria-label={`Rename sheet, page ${page.page_number}`}
            title="Rename sheet"
          >
            ✎
          </button>
        )}
        <StatusBadge tone={pageStatus.tone} label={pageStatus.label} />
        {kind && <StatusBadge tone="info" label={kind} />}
        {page.hidden && <StatusBadge tone="neutral" label="Hidden" />}
        {move && (
          <span className="page-card__move">
            <Button
              disabled={!move.earlier || move.pending}
              onClick={move.earlier}
              aria-label={`Move page ${page.page_number} earlier`}
            >
              ◀
            </Button>
            <Button disabled={!move.later || move.pending} onClick={move.later} aria-label={`Move page ${page.page_number} later`}>
              ▶
            </Button>
          </span>
        )}
      </div>

      <div className="page-card__body">
        {page.error_message && <p className="page-card__error">{page.error_message}</p>}
        <PageSummary page={page} />
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

/** What a card says about a page's run: progress while it runs, else its member count. The
 *  details (drawing type, scale, engine notes, review reasons) are in page review. */
function PageSummary({ page }: { page: DrawingPageListItem }) {
  const job = page.latest_job
  const run = page.current_run
  if (job && isActiveJob(job)) {
    return (
      <div className="page-card__progress" aria-live="polite">
        <div
          className="progress"
          role="progressbar"
          aria-label={`Processing page ${page.page_number}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={job.progress}
        >
          <div className="progress__bar" style={{ width: `${job.progress}%` }} />
        </div>
        <span className="muted">
          {JOB_STATUS[job.status].label}
          {job.stage ? ` — ${job.stage}` : ''}
        </span>
      </div>
    )
  }
  return (
    <>
      {job?.status === 'failed' && <p className="page-card__error">{job.error_message}</p>}
      {run && (
        <p className="page-card__members">
          {run.member_count} {run.member_count === 1 ? 'member' : 'members'}
          {job?.status === 'needs_review' && (
            <>
              {' '}
              <StatusBadge tone="warning" label="Needs review" />
            </>
          )}
        </p>
      )}
    </>
  )
}

/** A person's name for the sheet; saving it empty goes back to the name read from the drawing. */
function SheetNameDialog({ page, current, onClose }: { page: DrawingPageListItem; current: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(current)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const save = useMutation({
    mutationFn: () => nameSheet(page.id, name.trim()),
    meta: { suppressErrorToast: true, successMessage: 'Sheet name saved' },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set] })
      onClose()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Sheet name">
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField
          label="Sheet name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.fields.name}
          maxLength={200}
          hint="Leave empty to use the name read from the drawing."
          autoFocus
        />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={save.isPending}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

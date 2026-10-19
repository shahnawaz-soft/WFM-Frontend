import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { addPageToProject, removePageFromProject } from '../../api/abm'

import { toApiError } from '../../api/errors'
import { acceptAllOpen, markPageReviewed, reopenPageReview } from '../../api/members'
import type { DrawingPage, ExtractedMember } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { OPEN_STATUSES } from './reviewStatus'

interface ReviewBarProps {
  projectId: string
  page: DrawingPage
  members: ExtractedMember[]
  canEdit: boolean
  onChanged: () => void
}

/** Review progress for the page, with the page-level review actions. */
export function ReviewBar({ projectId, page, members, canEdit, onChanged }: ReviewBarProps) {
  const queryClient = useQueryClient()
  const [confirmAll, setConfirmAll] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const open = members.filter((m) => OPEN_STATUSES.includes(m.review_status)).length
  const decided = members.length - open
  const acceptable = members.filter(
    (m) => m.review_status === 'unreviewed' && !m.warnings.includes('unsupported_profile'),
  ).length
  const reviewed = page.status === 'reviewed'
  const added = page.status === 'added'
  const entries = members.filter((m) => m.review_status !== 'rejected').length

  const refreshPage = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['drawing-page', page.id] }),
      queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set, 'pages'] }),
      queryClient.invalidateQueries({ queryKey: ['abm', projectId] }),
    ])

  const acceptAll = useMutation({
    mutationFn: () => acceptAllOpen(page.id),
    onSuccess: ({ accepted }) => {
      setConfirmAll(false)
      notify.success(`Accepted ${accepted} ${accepted === 1 ? 'member' : 'members'}`)
      onChanged()
    },
  })
  const markReviewed = useMutation({
    mutationFn: () => markPageReviewed(page.id),
    meta: { successMessage: `Page ${page.page_number} marked reviewed` },
    onSuccess: refreshPage,
  })
  const reopen = useMutation({
    mutationFn: () => reopenPageReview(page.id),
    meta: { successMessage: 'Review reopened' },
    onSuccess: refreshPage,
  })

  const addToProject = useMutation({
    mutationFn: () => addPageToProject(page.id),
    meta: { successMessage: `Page ${page.page_number} added to the project` },
    onSuccess: refreshPage,
  })
  const remove = useMutation({
    mutationFn: () => removePageFromProject(page.id),
    meta: { successMessage: `Page ${page.page_number} removed from the project` },
    onSuccess: async () => {
      setConfirmRemove(false)
      await refreshPage()
    },
  })

  if (page.status !== 'processed' && !reviewed && !added) return null
  const failure = markReviewed.error ?? reopen.error ?? addToProject.error

  return (
    <div className="review-bar" aria-label="Page review">
      <div className="review-bar__progress">
        <div
          className="progress"
          role="progressbar"
          aria-label="Members decided"
          aria-valuemin={0}
          aria-valuemax={members.length}
          aria-valuenow={decided}
        >
          <div className="progress__bar" style={{ width: `${members.length ? (decided / members.length) * 100 : 100}%` }} />
        </div>
        <span>
          <strong>{decided}</strong> of {members.length} decided
          {open > 0 && <span className="muted"> · {open} to review</span>}
        </span>
      </div>
      {canEdit && page.status === 'processed' && (
        <div className="button-row button-row--tight">
          {acceptable > 0 && (
            <Button onClick={() => setConfirmAll(true)}>Accept all remaining ({acceptable})</Button>
          )}
          <Button
            variant="primary"
            disabled={open > 0}
            loading={markReviewed.isPending}
            onClick={() => markReviewed.mutate()}
            title={open > 0 ? 'Decide every member first' : undefined}
          >
            Mark page reviewed
          </Button>
        </div>
      )}
      {reviewed && (
        <>
          <p className="review-bar__done">✓ Page review complete.</p>
          {canEdit && (
            <div className="button-row button-row--tight">
              <Button variant="primary" loading={addToProject.isPending} onClick={() => addToProject.mutate()}>
                Add to project
              </Button>
              <Button onClick={() => reopen.mutate()} loading={reopen.isPending}>
                Reopen review
              </Button>
            </div>
          )}
          {canEdit && (
            <p className="muted review-bar__hint">
              Adding puts the {entries} non-rejected {entries === 1 ? 'member' : 'members'} into the project’s ABM.
            </p>
          )}
        </>
      )}
      {added && (
        <>
          <p className="review-bar__done">
            ✓ In the project’s ABM. <Link to={`/projects/${projectId}/abm`}>Open ABM</Link>
          </p>
          {canEdit && (
            <div className="button-row button-row--tight">
              <Button onClick={() => setConfirmRemove(true)}>Remove from project</Button>
            </div>
          )}
        </>
      )}
      {failure && <p className="page-card__error">{toApiError(failure).message}</p>}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove page ${page.page_number} from the project?`}
        confirmLabel="Remove from project"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>
          Its {entries} {entries === 1 ? 'entry leaves' : 'entries leave'} the ABM. The members, their
          corrections and review decisions are kept, and you can add the page again later.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirmAll}
        title={`Accept ${acceptable} remaining ${acceptable === 1 ? 'member' : 'members'}?`}
        confirmLabel="Accept all remaining"
        tone="primary"
        pending={acceptAll.isPending}
        error={acceptAll.error ? toApiError(acceptAll.error).message : null}
        onConfirm={() => acceptAll.mutate()}
        onCancel={() => setConfirmAll(false)}
      >
        <p>
          Every member still marked “To review” is accepted as it is. Members of unsupported section types are left for
          you to decide. Each acceptance is recorded in the member’s history.
        </p>
      </ConfirmDialog>
    </div>
  )
}

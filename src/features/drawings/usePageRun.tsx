import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { toApiError } from '../../api/errors'
import { runPlan } from '../../api/processing'
import type { DrawingPageListItem } from '../../api/types'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { isActiveJob } from './status'

export interface PageRunAction {
  label: 'Run Plan' | 'Retry' | 'Run again'
  onClick: () => void
}

/** The single source of truth for which processing action a page offers (grid + viewer). */
export function usePageRun(page: DrawingPageListItem, canRun: boolean) {
  const queryClient = useQueryClient()
  const [confirmRerun, setConfirmRerun] = useState(false)
  // Set when the server says people have already reviewed this page (OD-18).
  const [discardWarning, setDiscardWarning] = useState<string | null>(null)
  const job = page.latest_job

  const mutation = useMutation({
    mutationFn: (discardReview: boolean = false) => runPlan(page.id, { discardReview }),
    meta: { suppressErrorToast: true },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === 'review_in_progress') {
        setConfirmRerun(false)
        setDiscardWarning(apiError.message)
      }
    },
    onSuccess: () => {
      setConfirmRerun(false)
      setDiscardWarning(null)
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set, 'pages'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-page', page.id] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set, 'pages', 'viewer'] }),
      ])
    },
  })

  let action: PageRunAction | null = null
  if (canRun && page.thumbnail_status === 'ready' && !isActiveJob(job)) {
    if (page.status === 'processed') action = { label: 'Run again', onClick: () => setConfirmRerun(true) }
    else if (job?.status === 'failed') action = { label: 'Retry', onClick: () => mutation.mutate(false) }
    else if (page.status === 'pending' || page.status === 'failed') {
      action = { label: 'Run Plan', onClick: () => mutation.mutate(false) }
    }
  }

  const confirmDialog = (
    <ConfirmDialog
      open={confirmRerun}
      title={`Run page ${page.page_number} again?`}
      confirmLabel="Run again"
      tone="primary"
      pending={mutation.isPending}
      error={mutation.error && !discardWarning ? toApiError(mutation.error).message : null}
      onConfirm={() => mutation.mutate(false)}
      onCancel={() => setConfirmRerun(false)}
    >
      <p>
        The page is processed again and the new result replaces the current one. The previous result is kept in the
        page’s history.
      </p>
    </ConfirmDialog>
  )

  const discardDialog = (
    <ConfirmDialog
      open={discardWarning !== null}
      title="This page has review work"
      confirmLabel="Run again and replace review"
      tone="danger"
      pending={mutation.isPending}
      onConfirm={() => mutation.mutate(true)}
      onCancel={() => {
        setDiscardWarning(null)
        mutation.reset()
      }}
    >
      <p>{discardWarning}</p>
    </ConfirmDialog>
  )

  return {
    action,
    mutation,
    confirmDialog: (
      <>
        {confirmDialog}
        {discardDialog}
      </>
    ),
  }
}

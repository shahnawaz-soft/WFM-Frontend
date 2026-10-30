import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { toApiError } from '../../api/errors'
import { setPageArea } from '../../api/processing'
import type { DrawingPageListItem } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'

export type AreaBox = [number, number, number, number]

interface PageAreaControlsProps {
  page: DrawingPageListItem
  canEdit: boolean
  /** Drawing the box on the drawing now. */
  drawing: boolean
  onDraw: () => void
  /** A box just drawn (or ``area: null``: clear it), waiting to be confirmed. */
  proposed: { area: AreaBox | null } | null
  onPropose: (proposed: { area: AreaBox | null } | null) => void
}

/** The part of the sheet to count (like a takeoff area): what is outside the box is set aside
 *  when the page runs again, and on every later run. */
export function PageAreaControls({ page, canEdit, drawing, onDraw, proposed, onPropose }: PageAreaControlsProps) {
  const queryClient = useQueryClient()
  const [discardWarning, setDiscardWarning] = useState<string | null>(null)
  const area = (page.area as AreaBox | null) ?? null
  const save = useMutation({
    mutationFn: ({ area, discardReview }: { area: AreaBox | null; discardReview?: boolean }) =>
      setPageArea(page.id, area, { discardReview }),
    meta: { suppressErrorToast: true },
    onSuccess: async (_, { area }) => {
      onPropose(null)
      setDiscardWarning(null)
      notify.success(area ? 'Area saved: the page is running again' : 'Area cleared: the page is running again')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['drawing-page', page.id] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set, 'pages'] }),
      ])
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === 'review_in_progress') setDiscardWarning(apiError.message)
    },
  })
  const close = () => {
    onPropose(null)
    setDiscardWarning(null)
    save.reset()
  }

  if (!canEdit || !page.current_run || page.status !== 'processed') return null
  return (
    <>
      <Button
        aria-pressed={drawing}
        title="Drag a box around the part of the sheet to count: what is outside is not counted"
        onClick={onDraw}
      >
        {area ? 'Change area' : 'Area'}
      </Button>
      {area && <Button onClick={() => onPropose({ area: null })}>Clear area</Button>}
      <ConfirmDialog
        open={proposed !== null && discardWarning === null}
        title={proposed?.area ? 'Count only inside this area?' : 'Count the whole sheet again?'}
        confirmLabel={proposed?.area ? 'Save area and run again' : 'Clear area and run again'}
        tone="primary"
        pending={save.isPending}
        error={save.error && !discardWarning ? toApiError(save.error).message : null}
        onConfirm={() => proposed && save.mutate({ area: proposed.area })}
        onCancel={close}
      >
        <p>
          {proposed?.area
            ? 'Members outside the box are set aside and not counted (you can reopen any of them). '
            : 'Members outside the old box are counted again. '}
          The page runs again, and keeps this on every later run.
        </p>
      </ConfirmDialog>
      <ConfirmDialog
        open={discardWarning !== null}
        title="This page has review work"
        confirmLabel="Run again and replace review"
        tone="danger"
        pending={save.isPending}
        onConfirm={() => proposed && save.mutate({ area: proposed.area, discardReview: true })}
        onCancel={close}
      >
        <p>{discardWarning}</p>
      </ConfirmDialog>
    </>
  )
}


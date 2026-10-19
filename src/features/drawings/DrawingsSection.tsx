import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { downloadOriginal, listDrawingSets, listPages, removeDrawingSet, retryDrawingSet } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import type { DrawingSet, Project } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { projectCan } from '../projects/useProjectPermissions'
import { PageCard } from './PageCard'
import { drawingSetStatus, formatBytes, isActiveJob } from './status'
import { UploadPanel } from './UploadPanel'

const POLL_MS = 2000

export function DrawingsSection({ project }: { project: Project }) {
  const canEdit = projectCan(project, 'project.edit')
  const query = useQuery({
    queryKey: ['project', project.id, 'drawing-sets'],
    queryFn: () => listDrawingSets(project.id),
    // Keep checking while pages are being prepared in the background.
    refetchInterval: (q) => (q.state.data?.some((s) => s.status === 'processing') ? POLL_MS : false),
  })

  return (
    <section className="card" aria-labelledby="drawings-heading">
      <h2 id="drawings-heading">Drawings</h2>
      {canEdit && <UploadPanel project={project} />}

      {query.isPending && <LoadingState label="Loading drawing sets…" />}
      {query.error && (
        <ErrorState title="Could not load drawing sets" error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data?.length === 0 && (
        <EmptyState title="No drawings yet">
          {canEdit ? 'Upload a drawing set to get started.' : 'Drawing sets uploaded to this project appear here.'}
        </EmptyState>
      )}
      {query.data && query.data.length > 0 && (
        <ul className="drawing-sets" aria-label="Drawing sets">
          {query.data.map((set, index) => (
            <li key={set.id}>
              <DrawingSetCard drawingSet={set} canEdit={canEdit} initiallyOpen={index === 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DrawingSetCard({
  drawingSet,
  canEdit,
  initiallyOpen,
}: {
  drawingSet: DrawingSet
  canEdit: boolean
  initiallyOpen: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(initiallyOpen)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const status = drawingSetStatus(drawingSet)
  const pagesId = `pages-${drawingSet.id}`

  const retry = useMutation({
    mutationFn: () => retryDrawingSet(drawingSet.id),
    meta: { successMessage: 'Retrying the pages that failed' },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set', drawingSet.id, 'pages'] }),
      ]),
  })

  const remove = useMutation({
    mutationFn: () => removeDrawingSet(drawingSet.id),
    meta: { suppressErrorToast: true, successMessage: `Removed “${drawingSet.original_filename}”` },
    onSuccess: async () => {
      setConfirmRemove(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ])
    },
  })

  return (
    <article className="drawing-set" aria-label={drawingSet.original_filename}>
      <div className="drawing-set__header">
        <div>
          <h3 className="drawing-set__name">{drawingSet.original_filename}</h3>
          <p className="muted drawing-set__meta">
            {drawingSet.page_count} {drawingSet.page_count === 1 ? 'page' : 'pages'} · {formatBytes(drawingSet.size_bytes)} ·
            uploaded by {drawingSet.uploaded_by.full_name} on {new Date(drawingSet.created_at).toLocaleString()}
          </p>
          <StatusBadge tone={status.tone} label={status.label} />
          {drawingSet.status === 'failed' && drawingSet.error_message && (
            <p className="field__error">{drawingSet.error_message}</p>
          )}
        </div>
        <div className="button-row button-row--tight">
          {canEdit && drawingSet.can_retry && (
            <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
              Retry failed pages
            </Button>
          )}
          <Button
            onClick={() =>
              downloadOriginal(drawingSet).catch((e) => notify.error('Download failed', toApiError(e).message))
            }
          >
            Download PDF
          </Button>
          <Button aria-expanded={open} aria-controls={open ? pagesId : undefined} onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide pages' : 'Show pages'}
          </Button>
          {canEdit && (
            <Button onClick={() => setConfirmRemove(true)} aria-label={`Remove ${drawingSet.original_filename}`}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div id={pagesId}>
          <PageGrid drawingSet={drawingSet} canRun={canEdit} />
        </div>
      )}
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove “${drawingSet.original_filename}”?`}
        confirmLabel="Remove drawing set"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setConfirmRemove(false)
          remove.reset()
        }}
      >
        <p>
          The drawing set and its {drawingSet.page_count} {drawingSet.page_count === 1 ? 'page' : 'pages'} will no
          longer appear in this project. The original file is kept for the project history, and the removal is
          recorded.
        </p>
      </ConfirmDialog>
    </article>
  )
}

function PageGrid({ drawingSet, canRun }: { drawingSet: DrawingSet; canRun: boolean }) {
  const query = useQuery({
    queryKey: ['drawing-set', drawingSet.id, 'pages', drawingSet.status, drawingSet.pages_ready, drawingSet.pages_failed],
    queryFn: () => listPages(drawingSet.id),
    placeholderData: (previous) => previous,
    // Poll while any page is queued or being processed.
    refetchInterval: (q) => (q.state.data?.some((p) => isActiveJob(p.latest_job)) ? POLL_MS : false),
  })

  if (query.isPending) return <LoadingState label="Loading pages…" />
  if (query.error) return <ErrorState title="Could not load pages" error={query.error} onRetry={() => void query.refetch()} />
  return (
    <ol className="page-grid" aria-label={`Pages of ${drawingSet.original_filename}`}>
      {query.data.map((page) => (
        <PageCard key={page.id} page={page} projectId={drawingSet.project} setName={drawingSet.original_filename} canRun={canRun} />
      ))}
    </ol>
  )
}

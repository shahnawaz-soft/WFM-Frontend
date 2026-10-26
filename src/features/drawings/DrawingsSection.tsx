import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { downloadOriginal, listPages, removeDrawingSet, retryDrawingSet } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import { runAllPages, type SetRunResult } from '../../api/processing'
import { setRevises } from '../../api/revisions'
import type { DrawingSet, Project } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { SelectField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { projectCan } from '../projects/useProjectPermissions'
import { PageCard } from './PageCard'
import { drawingSetStatus, formatBytes, isActiveJob } from './status'
import { drawingSetsQuery } from './queries'
import { UploadPanel } from './UploadPanel'

const POLL_MS = 2000

export function DrawingsSection({ project }: { project: Project }) {
  const canEdit = projectCan(project, 'project.edit')
  const query = useQuery(drawingSetsQuery(project.id))

  return (
    <section className="card" aria-labelledby="drawings-heading">
      <h2 id="drawings-heading">Drawings</h2>
      {canEdit && <UploadPanel project={project} drawingSets={query.data} />}

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
              <DrawingSetCard drawingSet={set} allSets={query.data} canEdit={canEdit} initiallyOpen={index === 0} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function DrawingSetCard({
  drawingSet,
  allSets,
  canEdit,
  initiallyOpen,
}: {
  drawingSet: DrawingSet
  allSets: DrawingSet[]
  canEdit: boolean
  initiallyOpen: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(initiallyOpen)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const status = drawingSetStatus(drawingSet)
  // Preparing the pages ran out of time: nothing failed, the rest is still to prepare.
  const timedOut = drawingSet.status === 'failed' && drawingSet.error_code === 'ingest_timed_out'
  const pagesId = `pages-${drawingSet.id}`

  const retry = useMutation({
    mutationFn: () => retryDrawingSet(drawingSet.id),
    meta: { successMessage: timedOut ? 'Preparing the rest of the pages' : 'Retrying the pages that failed' },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set', drawingSet.id, 'pages'] }),
      ]),
  })

  const runAll = useMutation({
    mutationFn: () => runAllPages(drawingSet.id),
    onSuccess: (result) => {
      setOpen(true) // show the pages being processed
      const { title, description } = runAllMessage(result)
      notify.info(title, description)
      return queryClient.invalidateQueries({ queryKey: ['drawing-set', drawingSet.id, 'pages'] })
    },
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
          <RevisionLine drawingSet={drawingSet} allSets={allSets} canEdit={canEdit} />
          {drawingSet.status === 'failed' && drawingSet.error_message && (
            <p className="field__error">{drawingSet.error_message}</p>
          )}
        </div>
        <div className="button-row button-row--tight">
          {canEdit && drawingSet.can_retry && (
            <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
              {timedOut ? 'Retry' : 'Retry failed pages'}
            </Button>
          )}
          {canEdit && drawingSet.status === 'ready' && (
            <Button variant="primary" loading={runAll.isPending} onClick={() => runAll.mutate()}>
              Run all pages
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

/** The toast after "Run all pages": what was queued, already running, or couldn't be run. */
function runAllMessage(result: SetRunResult): { title: string; description?: string } {
  const plural = (n: number) => (n === 1 ? 'page' : 'pages')
  const notes: string[] = []
  if (result.running.length) notes.push(`${result.running.length} ${plural(result.running.length)} already running.`)
  if (result.skipped.length) {
    notes.push(
      `${result.skipped.length} ${plural(result.skipped.length)} could not be run (${result.skipped
        .map((s) => s.page)
        .join(', ')}): use “Retry failed pages” first.`,
    )
  }
  const description = notes.length ? notes.join(' ') : undefined
  if (result.queued.length) {
    return { title: `Running ${result.queued.length} ${plural(result.queued.length)}`, description }
  }
  if (result.running.length || result.skipped.length) return { title: 'No new pages to run', description }
  return {
    title: 'Every page has already been run',
    description: 'Use “Run again” on a page to process it again.',
  }
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

/** Which earlier set this one revises, a link to the comparison, and (for editors) a way to say so. */
function RevisionLine({ drawingSet, allSets, canEdit }: { drawingSet: DrawingSet; allSets: DrawingSet[]; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const earlier = allSets.filter((s) => s.id !== drawingSet.id && s.created_at < drawingSet.created_at)
  const revises = allSets.find((s) => s.id === drawingSet.revises)
  const link = useMutation({
    mutationFn: (id: string | null) => setRevises(drawingSet.id, id),
    meta: { successMessage: 'Revision saved' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
  })
  if (!revises && (!canEdit || earlier.length === 0)) return null
  return (
    <div className="drawing-set__revision">
      {revises && (
        <p>
          Revision of <strong>{revises.original_filename}</strong> ·{' '}
          <Link to={`/projects/${drawingSet.project}/revisions/${drawingSet.id}`}>Compare changes</Link>
        </p>
      )}
      {canEdit && earlier.length > 0 && (
        <SelectField
          label="Revises"
          value={drawingSet.revises ?? ''}
          disabled={link.isPending}
          onChange={(e) => link.mutate(e.target.value || null)}
          options={[{ value: '', label: 'No earlier set' }, ...earlier.map((s) => ({ value: s.id, label: s.original_filename }))]}
        />
      )}
    </div>
  )
}

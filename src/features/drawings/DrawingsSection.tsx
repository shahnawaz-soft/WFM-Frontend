import * as Menu from '@radix-ui/react-dropdown-menu'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { downloadOriginal, hidePages, removeDrawingSet, retryDrawingSet } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import { runAllPages, type SetRunResult } from '../../api/processing'
import { setRevises } from '../../api/revisions'
import type { DrawingSet, Project } from '../../api/types'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { SelectField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { projectCan } from '../projects/useProjectPermissions'
import { PageCard } from './PageCard'
import { AddToBatchDialog, BatchSections } from './Batches'
import { KIND_GROUPS, kindGroup, repeatedNumbers, sheetLabel, type KindGroup } from './sheets'
import { drawingSetStatus, formatBytes } from './status'
import { batchesQuery, drawingSetsQuery, pagesQuery } from './queries'
import { UploadPanel } from './UploadPanel'

export function DrawingsSection({ project }: { project: Project }) {
  const canEdit = projectCan(project, 'project.edit')
  const queryClient = useQueryClient()
  const query = useQuery(drawingSetsQuery(project.id))
  const sets = query.data
  // The upload area is open for an empty project and one click away once it has drawings.
  const empty = sets?.length === 0
  const [uploadOpen, setUploadOpen] = useState(empty)
  const [wasEmpty, setWasEmpty] = useState(empty)
  if (empty !== wasEmpty) {
    setWasEmpty(empty)
    if (empty) setUploadOpen(true)
  }
  const hiddenCount = sets?.reduce((n, s) => n + s.pages_hidden, 0) ?? 0
  const pageCount = (sets?.reduce((n, s) => n + s.page_count, 0) ?? 0) - hiddenCount
  const [showHidden, setShowHidden] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const toggle = (pageId: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(pageId)) next.add(pageId)
      return next
    })
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }
  const batches = useQuery(batchesQuery(project.id))
  // Plans, elevations, details …: what the engine classified each run page as.
  const [kind, setKind] = useState<KindGroup>('all')
  const lists = useQueries({ queries: (sets ?? []).map((set) => pagesQuery(set)) })
  const visiblePages = lists.flatMap((l) => l.data ?? []).filter((p) => showHidden || !p.hidden)
  const kindCounts = new Map<string, number>()
  for (const page of visiblePages) kindCounts.set(kindGroup(page), (kindCounts.get(kindGroup(page)) ?? 0) + 1)
  const [batching, setBatching] = useState(false)
  const hide = useMutation({
    mutationFn: (hidden: boolean) => hidePages(project.id, [...selected], hidden),
    onSuccess: ({ updated }, hidden) => {
      const pages = `${updated} ${updated === 1 ? 'page' : 'pages'}`
      notify.success(hidden ? `${pages} hidden` : `${pages} shown again`)
      stopSelecting()
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set'] }),
      ])
    },
  })
  const runnable = sets?.filter((s) => s.status === 'ready') ?? []

  const runAll = useMutation({
    mutationFn: async () => {
      const results = await Promise.all(runnable.map((s) => runAllPages(s.id)))
      return results.reduce<SetRunResult>(
        (all, r) => ({
          queued: [...all.queued, ...r.queued],
          running: [...all.running, ...r.running],
          skipped: [...all.skipped, ...r.skipped],
        }),
        { queued: [], running: [], skipped: [] },
      )
    },
    onSuccess: (result) => {
      const { title, description } = runAllMessage(result)
      notify.info(title, description)
      return queryClient.invalidateQueries({ queryKey: ['drawing-set'] })
    },
  })

  return (
    <section className="card" aria-labelledby="drawings-heading">
      <div className="card__header">
        <h2 id="drawings-heading">{pageCount ? `Pages (${pageCount})` : 'Pages'}</h2>
        {sets && sets.length > 0 && (
          <div className="button-row button-row--tight">
            {hiddenCount > 0 && (
              <Button aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
                {showHidden ? 'Leave out hidden pages' : `Show hidden pages (${hiddenCount})`}
              </Button>
            )}
            {canEdit && (
              <Button aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                Select pages
              </Button>
            )}
            {canEdit && (
              <Button aria-expanded={uploadOpen} onClick={() => setUploadOpen((o) => !o)}>
                Upload PDF
              </Button>
            )}
            {canEdit && runnable.length > 0 && (
              <Button variant="primary" loading={runAll.isPending} onClick={() => runAll.mutate()}>
                Run all pages
              </Button>
            )}
          </div>
        )}
      </div>
      {selecting && (
        <div className="selection-bar" role="toolbar" aria-label="Selected pages">
          <span>
            {selected.size} {selected.size === 1 ? 'page' : 'pages'} selected
          </span>
          <Button disabled={!selected.size} loading={hide.isPending && hide.variables} onClick={() => hide.mutate(true)}>
            Hide selected ({selected.size})
          </Button>
          {showHidden && (
            <Button disabled={!selected.size} loading={hide.isPending && !hide.variables} onClick={() => hide.mutate(false)}>
              Show selected ({selected.size})
            </Button>
          )}
          <Button disabled={!selected.size} onClick={() => setBatching(true)}>
            Add to batch… ({selected.size})
          </Button>
          <Button onClick={stopSelecting}>Cancel</Button>
        </div>
      )}
      {batching && (
        <AddToBatchDialog
          projectId={project.id}
          batches={batches.data ?? []}
          pageIds={[...selected]}
          onClose={(done) => {
            setBatching(false)
            if (done) stopSelecting()
          }}
        />
      )}
      {canEdit && uploadOpen && <UploadPanel project={project} drawingSets={sets} />}
      {kindCounts.size > 1 && (
        <div className="kind-filter" role="group" aria-label="Show sheets">
          <Button aria-pressed={kind === 'all'} onClick={() => setKind('all')}>
            All ({visiblePages.length})
          </Button>
          {KIND_GROUPS.filter((g) => kindCounts.has(g.key)).map((g) => (
            <Button key={g.key} aria-pressed={kind === g.key} onClick={() => setKind(g.key)}>
              {g.label} ({kindCounts.get(g.key)})
            </Button>
          ))}
        </div>
      )}

      {query.isPending && <LoadingState label="Loading drawing sets…" />}
      {query.error && (
        <ErrorState title="Could not load drawing sets" error={query.error} onRetry={() => void query.refetch()} />
      )}
      {sets?.length === 0 && (
        <EmptyState title="No drawings yet">
          {canEdit ? 'Upload a drawing set to get started.' : 'Drawing sets uploaded to this project appear here.'}
        </EmptyState>
      )}
      {sets && sets.length > 0 && (
        <>
          <ul className="file-strip" aria-label="Drawing sets">
            {sets.map((set) => (
              <li key={set.id}>
                <FileRow drawingSet={set} allSets={sets} canEdit={canEdit} />
              </li>
            ))}
          </ul>
          {batches.data && batches.data.length > 0 && (
            <BatchSections
              projectId={project.id}
              batches={batches.data}
              sets={sets}
              canEdit={canEdit}
              showHidden={showHidden}
              kind={kind}
              selection={selecting ? { selected, toggle } : undefined}
            />
          )}
          {sets.map((set) => (
            <PageGrid
              key={set.id}
              drawingSet={set}
              canRun={canEdit}
              showHidden={showHidden}
              kind={kind}
              selection={selecting ? { selected, toggle } : undefined}
            />
          ))}
        </>
      )}
    </section>
  )
}

/** One uploaded PDF, compact: name, pages, state, and its actions in a menu. */
function FileRow({ drawingSet, allSets, canEdit }: { drawingSet: DrawingSet; allSets: DrawingSet[]; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [dialog, setDialog] = useState<'remove' | 'revision' | null>(null)
  const status = drawingSetStatus(drawingSet)
  // Preparing the pages ran out of time: nothing failed, the rest is still to prepare.
  const timedOut = drawingSet.status === 'failed' && drawingSet.error_code === 'ingest_timed_out'
  const earlier = allSets.filter((s) => s.id !== drawingSet.id && s.created_at < drawingSet.created_at)
  const revises = allSets.find((s) => s.id === drawingSet.revises)
  const name = drawingSet.original_filename

  const retry = useMutation({
    mutationFn: () => retryDrawingSet(drawingSet.id),
    meta: { successMessage: timedOut ? 'Preparing the rest of the pages' : 'Retrying the pages that failed' },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set', drawingSet.id, 'pages'] }),
      ]),
  })

  const remove = useMutation({
    mutationFn: () => removeDrawingSet(drawingSet.id),
    meta: { suppressErrorToast: true, successMessage: `Removed “${name}”` },
    onSuccess: async () => {
      setDialog(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ])
    },
  })

  return (
    <article className="file-row" aria-label={name}>
      <span className="file-row__name">{name}</span>
      <span className="muted">
        {drawingSet.page_count} {drawingSet.page_count === 1 ? 'page' : 'pages'}
      </span>
      <StatusBadge tone={status.tone} label={status.label} />
      {revises && (
        <span className="muted">
          Revision of {revises.original_filename} ·{' '}
          <Link to={`/projects/${drawingSet.project}/revisions/${drawingSet.id}`}>Compare changes</Link>
        </span>
      )}
      {canEdit && drawingSet.can_retry && (
        <Button variant="primary" loading={retry.isPending} onClick={() => retry.mutate()}>
          {timedOut ? 'Retry' : 'Retry failed pages'}
        </Button>
      )}
      <Menu.Root>
        <Menu.Trigger className="button button--secondary file-row__menu" aria-label={`Actions for ${name}`}>
          ⋯
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content className="menu" align="end" sideOffset={6}>
            <div className="menu__header">
              <span>
                {formatBytes(drawingSet.size_bytes)} · uploaded by {drawingSet.uploaded_by.full_name} on{' '}
                {new Date(drawingSet.created_at).toLocaleString()}
              </span>
            </div>
            <Menu.Separator className="menu__separator" />
            <Menu.Item
              className="menu__item"
              onSelect={() => downloadOriginal(drawingSet).catch((e) => notify.error('Download failed', toApiError(e).message))}
            >
              Download PDF
            </Menu.Item>
            {canEdit && earlier.length > 0 && (
              <Menu.Item className="menu__item" onSelect={() => setDialog('revision')}>
                Revision of…
              </Menu.Item>
            )}
            {canEdit && (
              <Menu.Item
                className="menu__item"
                onSelect={() => {
                  setDialog('remove')
                  // Pages may have been added to the ABM since the list loaded: warn with fresh counts.
                  void queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] })
                }}
              >
                Remove
              </Menu.Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {drawingSet.status === 'failed' && drawingSet.error_message && (
        <p className="field__error file-row__error">{drawingSet.error_message}</p>
      )}
      {dialog === 'revision' && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)} title={`Is “${name}” a revision?`}>
          <RevisionPicker drawingSet={drawingSet} earlier={earlier} />
          <div className="button-row">
            <Button onClick={() => setDialog(null)}>Done</Button>
          </div>
        </Dialog>
      )}
      <ConfirmDialog
        open={dialog === 'remove'}
        title={`Remove “${name}”?`}
        confirmLabel="Remove drawing set"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setDialog(null)
          remove.reset()
        }}
      >
        <p>
          The drawing set and its {drawingSet.page_count} {drawingSet.page_count === 1 ? 'page' : 'pages'} will no
          longer appear in this project. The original file is kept for the project history, and the removal is
          recorded.
        </p>
        {drawingSet.pages_in_abm > 0 && (
          <p className="notice notice--warning" role="note">
            {drawingSet.pages_in_abm} {drawingSet.pages_in_abm === 1 ? 'page is' : 'pages are'} in the ABM. Their members
            will leave the ABM and the tonnage. Finalised versions keep what they recorded.
          </p>
        )}
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

export interface PageSelection {
  selected: ReadonlySet<string>
  toggle: (pageId: string) => void
}

function PageGrid({
  drawingSet,
  canRun,
  showHidden,
  kind,
  selection,
}: {
  drawingSet: DrawingSet
  canRun: boolean
  showHidden: boolean
  kind: KindGroup
  selection?: PageSelection
}) {
  const query = useQuery(pagesQuery(drawingSet))

  if (query.isPending) return <LoadingState label="Loading pages…" />
  if (query.error) return <ErrorState title="Could not load pages" error={query.error} onRetry={() => void query.refetch()} />
  // Pages in a batch are shown in its section instead.
  const repeated = repeatedNumbers(query.data)
  const pages = query.data.filter(
    (p) => !p.batch && (showHidden || !p.hidden) && (kind === 'all' || kindGroup(p) === kind),
  )
  if (!pages.length) return null
  return (
    <ol className="page-grid" aria-label={`Pages of ${drawingSet.original_filename}`}>
      {pages.map((page) => (
        <PageCard
          key={page.id}
          page={page}
          projectId={drawingSet.project}
          setName={drawingSet.original_filename}
          canRun={canRun}
          selection={selection}
          sheetName={sheetLabel(page, repeated)}
        />
      ))}
    </ol>
  )
}

/** Which earlier set this one revises (the comparison link is on the file row). */
function RevisionPicker({ drawingSet, earlier }: { drawingSet: DrawingSet; earlier: DrawingSet[] }) {
  const queryClient = useQueryClient()
  const link = useMutation({
    mutationFn: (id: string | null) => setRevises(drawingSet.id, id),
    meta: { successMessage: 'Revision saved' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['project', drawingSet.project, 'drawing-sets'] }),
  })
  return (
    <SelectField
      label="Revises"
      value={drawingSet.revises ?? ''}
      disabled={link.isPending}
      onChange={(e) => link.mutate(e.target.value || null)}
      options={[{ value: '', label: 'No earlier set' }, ...earlier.map((s) => ({ value: s.id, label: s.original_filename }))]}
    />
  )
}

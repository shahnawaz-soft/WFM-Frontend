import { useMutation, useQueries, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { arrangePages, createBatch, deleteBatch, renameBatch } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import type { DrawingPageListItem, DrawingSet, PageBatch } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import type { PageSelection } from './DrawingsSection'
import { PageCard } from './PageCard'
import { pagesQuery } from './queries'
import { kindGroup, repeatedNumbers, sheetLabel, type KindGroup } from './sheets'

/** After a batch change: batches, and the page lists (each page says its batch). */
function useRefresh(projectId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'batches'] }),
      queryClient.invalidateQueries({ queryKey: ['drawing-set'] }),
    ])
}

/** One section per batch, its pages in the batch's order (they can be moved within it). */
export function BatchSections({
  projectId,
  batches,
  sets,
  canEdit,
  showHidden,
  kind,
  selection,
}: {
  projectId: string
  batches: PageBatch[]
  sets: DrawingSet[]
  canEdit: boolean
  showHidden: boolean
  kind: KindGroup
  selection?: PageSelection
}) {
  const lists = useQueries({ queries: sets.map((set) => pagesQuery(set)) })
  const pages = new Map<string, { page: DrawingPageListItem; set: DrawingSet; name: string }>()
  lists.forEach((list, i) => {
    const repeated = repeatedNumbers(list.data ?? [])
    list.data?.forEach((page) => pages.set(page.id, { page, set: sets[i]!, name: sheetLabel(page, repeated) }))
  })
  return (
    <>
      {batches.map((batch) => (
        <BatchSection
          key={batch.id}
          projectId={projectId}
          batch={batch}
          pages={batch.pages
            .flatMap((id) => pages.get(id) ?? [])
            .filter(({ page }) => (showHidden || !page.hidden) && (kind === 'all' || kindGroup(page) === kind))}
          canEdit={canEdit}
          selection={selection}
        />
      ))}
    </>
  )
}

function BatchSection({
  projectId,
  batch,
  pages,
  canEdit,
  selection,
}: {
  projectId: string
  batch: PageBatch
  pages: { page: DrawingPageListItem; set: DrawingSet; name: string }[]
  canEdit: boolean
  selection?: PageSelection
}) {
  const refresh = useRefresh(projectId)
  const [dialog, setDialog] = useState<'rename' | 'delete' | null>(null)
  const move = useMutation({
    mutationFn: (order: string[]) => arrangePages(projectId, batch.id, order),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: () => deleteBatch(batch.id),
    meta: { suppressErrorToast: true, successMessage: `Deleted the batch “${batch.name}”` },
    onSuccess: async () => {
      setDialog(null)
      await refresh()
    },
  })
  const moveBy = (index: number, step: -1 | 1) => {
    const order = [...batch.pages]
    const from = order.indexOf(pages[index]!.page.id)
    const to = order.indexOf(pages[index + step]!.page.id)
    ;[order[from], order[to]] = [order[to]!, order[from]!]
    move.mutate(order)
  }

  return (
    <section className="batch" aria-labelledby={`batch-${batch.id}`}>
      <div className="batch__header">
        <h3 id={`batch-${batch.id}`}>
          {batch.name} <span className="muted">({pages.length})</span>
        </h3>
        {canEdit && (
          <div className="button-row button-row--tight">
            <Button onClick={() => setDialog('rename')} aria-label={`Rename batch ${batch.name}`}>
              Rename
            </Button>
            <Button onClick={() => setDialog('delete')} aria-label={`Delete batch ${batch.name}`}>
              Delete
            </Button>
          </div>
        )}
      </div>
      {pages.length === 0 ? (
        <p className="muted">No pages yet. Select pages, then choose Add to batch.</p>
      ) : (
        <ol className="page-grid" aria-label={`Pages in ${batch.name}`}>
          {pages.map(({ page, set, name }, index) => (
            <PageCard
              key={page.id}
              page={page}
              projectId={projectId}
              setName={set.original_filename}
              canRun={canEdit}
              selection={selection}
              sheetName={name}
              move={
                canEdit
                  ? {
                      earlier: index > 0 ? () => moveBy(index, -1) : undefined,
                      later: index < pages.length - 1 ? () => moveBy(index, 1) : undefined,
                      pending: move.isPending,
                    }
                  : undefined
              }
            />
          ))}
        </ol>
      )}
      {dialog === 'rename' && <RenameBatchDialog projectId={projectId} batch={batch} onClose={() => setDialog(null)} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        title={`Delete the batch “${batch.name}”?`}
        confirmLabel="Delete batch"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => setDialog(null)}
      >
        <p>Its pages stay in the project, out of any batch.</p>
      </ConfirmDialog>
    </section>
  )
}

function RenameBatchDialog({ projectId, batch, onClose }: { projectId: string; batch: PageBatch; onClose: () => void }) {
  const refresh = useRefresh(projectId)
  const [name, setName] = useState(batch.name)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const rename = useMutation({
    mutationFn: () => renameBatch(batch.id, name.trim()),
    meta: { suppressErrorToast: true, successMessage: 'Batch renamed' },
    onSuccess: async () => {
      await refresh()
      onClose()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setErrors({ fields: { name: ['Enter a name.'] }, form: null })
    rename.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Rename batch">
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField label="Batch name" value={name} onChange={(e) => setName(e.target.value)} error={errors.fields.name} maxLength={120} autoFocus />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={rename.isPending}>
            Save
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

const NEW = ''

/** Put the selected pages in an existing batch or a new one, in the order they were ticked. */
export function AddToBatchDialog({
  projectId,
  batches,
  pageIds,
  onClose,
}: {
  projectId: string
  batches: PageBatch[]
  pageIds: string[]
  onClose: (done: boolean) => void
}) {
  const refresh = useRefresh(projectId)
  const [target, setTarget] = useState(batches[0]?.id ?? NEW)
  const [name, setName] = useState('')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const add = useMutation({
    mutationFn: async () => {
      const batchId = target === NEW ? (await createBatch(projectId, name.trim())).id : target
      const existing = batches.find((b) => b.id === batchId)?.pages ?? []
      // New pages go after the batch's own (the server keeps the rest in their order).
      return arrangePages(projectId, batchId, [...existing.filter((id) => !pageIds.includes(id)), ...pageIds])
    },
    meta: { suppressErrorToast: true, successMessage: `${pageIds.length} ${pageIds.length === 1 ? 'page' : 'pages'} added to the batch` },
    onSuccess: async () => {
      await refresh()
      onClose(true)
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (target === NEW && !name.trim()) return setErrors({ fields: { name: ['Enter a name for the new batch.'] }, form: null })
    add.mutate()
  }
  const count = `${pageIds.length} ${pageIds.length === 1 ? 'page' : 'pages'}`
  return (
    <Dialog open onOpenChange={(o) => !o && onClose(false)} title={`Add ${count} to a batch`}>
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        {batches.length > 0 && (
          <SelectField
            label="Batch"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            options={[...batches.map((b) => ({ value: b.id, label: b.name })), { value: NEW, label: 'New batch…' }]}
          />
        )}
        {target === NEW && (
          <TextField
            label="New batch name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={errors.fields.name}
            maxLength={120}
            placeholder="e.g. Level 2 framing"
            autoFocus
          />
        )}
        <div className="button-row">
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add pages
          </Button>
          <Button onClick={() => onClose(false)}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

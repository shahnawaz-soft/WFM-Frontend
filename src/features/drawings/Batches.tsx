import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { arrangePages, createBatch, deleteBatch, renameBatch, setBatchAssignees } from '../../api/drawings'
import { getProject, listMembers, lookupUsers } from '../../api/projects'
import { toApiError } from '../../api/errors'
import type { PageBatch, UserLookup } from '../../api/types'
import { LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { projectCan } from '../projects/useProjectPermissions'
import { PageCard } from './PageCard'
import type { BatchPageItem } from './batchPages'
import type { KindGroup } from './sheets'

/** After a batch change: batches, and the page lists (each page says its batch). */
function useRefresh(projectId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', projectId, 'batches'] }),
      queryClient.invalidateQueries({ queryKey: ['drawing-set'] }),
    ])
}

const assigneeNames = (batch: PageBatch) => batch.assignees.map((a) => a.full_name).join(', ')

/** The project's batches, one row each (assigned to the current user first): each opens on
 *  its own page. Owners and reviewers assign engineers from here. */
export function BatchList({
  projectId,
  batches,
  userId,
  canAssign,
}: {
  projectId: string
  batches: PageBatch[]
  userId: string | undefined
  canAssign: boolean
}) {
  const [assigning, setAssigning] = useState<PageBatch | null>(null)
  const mine = (b: PageBatch) => b.assignees.some((a) => a.id === userId)
  const ordered = [...batches.filter(mine), ...batches.filter((b) => !mine(b))]
  return (
    <section aria-labelledby="batches-heading" className="batch-list">
      <h3 id="batches-heading">Batches ({batches.length})</h3>
      <ul aria-label="Batches">
        {ordered.map((batch) => {
          const { pages, processed, reviewed, added } = batch.progress
          return (
            <li key={batch.id} className="batch-row" aria-label={batch.name}>
              <div className="batch-row__name">
                <Link to={`/projects/${projectId}/batches/${batch.id}`}>{batch.name}</Link>
                {mine(batch) && <StatusBadge tone="info" label="Assigned to you" />}
              </div>
              <span className="muted">
                {batch.assignees.length ? `Assigned to ${assigneeNames(batch)}` : 'Not assigned'}
              </span>
              <span className="muted">
                {pages} {pages === 1 ? 'page' : 'pages'} · {processed} processed · {reviewed} reviewed · {added} added
              </span>
              {canAssign && (
                <Button onClick={() => setAssigning(batch)} aria-label={`Assign batch ${batch.name}`}>
                  Assign
                </Button>
              )}
            </li>
          )
        })}
      </ul>
      {assigning && <AssignDialog projectId={projectId} batch={assigning} onClose={() => setAssigning(null)} />}
    </section>
  )
}

/** Choose the engineers working on a batch, one or several (none: open to every editor):
 *  the project's members, or (an owner) anyone found by name or email, who is then added to
 *  the project as an editor. */
export function AssignDialog({ projectId, batch, onClose }: { projectId: string; batch: PageBatch; onClose: () => void }) {
  const refresh = useRefresh(projectId)
  const queryClient = useQueryClient()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const canAddPeople = projectCan(project.data, 'project.manage_members')
  const members = useQuery({ queryKey: ['project', projectId, 'members'], queryFn: () => listMembers(projectId) })
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set(batch.assignees.map((a) => a.id)))
  const [newcomers, setNewcomers] = useState<UserLookup[]>([])
  const [search, setSearch] = useState('')
  const debounced = useDebouncedValue(search.trim())
  const found = useQuery({
    queryKey: ['users', 'lookup', debounced],
    queryFn: () => lookupUsers(debounced),
    enabled: canAddPeople && debounced.length >= 2,
  })
  const memberIds = new Set((members.data ?? []).map((m) => m.user.id))
  const candidates = (found.data ?? []).filter((u) => !memberIds.has(u.id) && !newcomers.some((n) => n.id === u.id))
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const save = useMutation({
    mutationFn: () => setBatchAssignees(batch.id, [...chosen]),
    meta: { suppressErrorToast: true, successMessage: `Saved who works on “${batch.name}”` },
    onSuccess: async () => {
      await Promise.all([
        refresh(),
        queryClient.invalidateQueries({ queryKey: ['project', projectId, 'members'] }),
        queryClient.invalidateQueries({ queryKey: ['project', projectId], exact: true }),
      ])
      onClose()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  const pick = (user: UserLookup) => {
    setNewcomers((current) => [...current, user])
    setChosen((current) => new Set([...current, user.id]))
    setSearch('')
  }
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Assign “${batch.name}”`}>
      <FormAlert message={errors.form ?? errors.fields.assignees?.[0] ?? null} />
      <form onSubmit={submit} noValidate>
        <p className="muted">
          Editors work only on pages of batches assigned to them. Owners and reviewers work on every page. A batch
          assigned to no one is open to every editor.
        </p>
        {members.isPending && <LoadingState label="Loading members…" />}
        {members.data && (
          <fieldset className="assignee-list">
            <legend>Engineers</legend>
            {members.data
              .filter((m) => m.role !== 'viewer')
              .map((m) => (
                <label key={m.user.id} className="checkbox">
                  <input type="checkbox" checked={chosen.has(m.user.id)} onChange={() => toggle(m.user.id)} />
                  {m.user.full_name} <span className="muted">({m.role})</span>
                </label>
              ))}
            {newcomers.map((u) => (
              <label key={u.id} className="checkbox">
                <input type="checkbox" checked={chosen.has(u.id)} onChange={() => toggle(u.id)} />
                {u.full_name} <span className="muted">(added to the project as an editor)</span>
              </label>
            ))}
          </fieldset>
        )}
        {canAddPeople && (
          <>
            <TextField
              label="Add someone not in this project"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email"
              autoComplete="off"
            />
            {debounced.length >= 2 && found.isSuccess && (
              <ul className="assignee-results" aria-label="People found">
                {candidates.length === 0 && <li className="muted">No one else found.</li>}
                {candidates.map((u) => (
                  <li key={u.id}>
                    <Button onClick={() => pick(u)} aria-label={`Add ${u.full_name}`}>
                      {u.full_name} <span className="muted">{u.email}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
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

/** A batch's pages, which can be moved within it, run and reviewed by whoever may work on
 *  them. ``canArrange``: rename, delete and reorder (a lead's once batches are assigned). */
export function BatchSection({
  projectId,
  batch,
  pages,
  canArrange,
  canAssign,
  kind,
  onDeleted,
}: {
  projectId: string
  batch: PageBatch
  pages: BatchPageItem[]
  canArrange: boolean
  canAssign: boolean
  kind: KindGroup
  onDeleted?: () => void
}) {
  const refresh = useRefresh(projectId)
  const [dialog, setDialog] = useState<'rename' | 'delete' | 'assign' | null>(null)
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
      onDeleted?.()
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
        <div>
          <h3 id={`batch-${batch.id}`}>
            {batch.name} <span className="muted">({pages.length})</span>
          </h3>
          <p className="muted batch__assignees">
            {batch.assignees.length ? `Assigned to ${assigneeNames(batch)}` : 'Not assigned: open to every editor'}
            {!batch.can_work && ' · You can look at these pages; the engineers assigned work on them.'}
          </p>
        </div>
        <div className="button-row button-row--tight">
          {canAssign && (
            <Button onClick={() => setDialog('assign')} aria-label={`Assign batch ${batch.name}`}>
              Assign
            </Button>
          )}
          {canArrange && (
            <>
              <Button onClick={() => setDialog('rename')} aria-label={`Rename batch ${batch.name}`}>
                Rename
              </Button>
              <Button onClick={() => setDialog('delete')} aria-label={`Delete batch ${batch.name}`}>
                Delete
              </Button>
            </>
          )}
        </div>
      </div>
      {pages.length === 0 ? (
        <p className="muted">No pages yet. Select pages on the project page, then choose Add to batch.</p>
      ) : (
        <ol className="page-grid" aria-label={`Pages in ${batch.name}`}>
          {pages.map(({ page, set, name }, index) => (
            <PageCard
              key={page.id}
              page={page}
              projectId={projectId}
              setName={set.original_filename}
              canRun={batch.can_work}
              batchId={batch.id}
              sheetName={name}
              tab={kind}
              move={
                canArrange
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
      {dialog === 'assign' && <AssignDialog projectId={projectId} batch={batch} onClose={() => setDialog(null)} />}
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

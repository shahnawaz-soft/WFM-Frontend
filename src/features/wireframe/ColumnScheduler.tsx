import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Fragment, memo, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

import { toApiError } from '../../api/errors'
import { searchProfiles } from '../../api/sections'
import type { ColumnChanges, SchedulerColumns, SchedulerLevel, SchedulerRow, WireframeGrid } from '../../api/types'
import {
  applyColumnsToAbm,
  bulkEditColumns,
  createColumnMetaGroup,
  deleteColumnMetaGroup,
  downloadColumnsCsv,
  getSchedulerColumns,
  listColumnMetaGroups,
} from '../../api/wireframe'
import { LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { Pager } from '../../components/ui/Pager'
import { usePage } from '../../components/ui/usePage'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { signedFeetInches } from '../abm/format'
import { groupColumns, type ColumnGroup } from './columnGroups'
import { ColumnGridView } from './ColumnGridView'
import { ColumnMetaGroups } from './ColumnMetaGroups'
import { memberKey } from './metaGroups'
import { ColumnVisual } from './ColumnVisual'

const ROTATIONS: { value: SchedulerRow['rotation']; label: string }[] = [
  { value: 'F', label: 'Front' },
  { value: 'T', label: 'Top' },
  { value: 'B', label: 'Back' },
  { value: 'BL', label: 'Below' },
]
const TYPES: { value: SchedulerRow['column_type']; label: string }[] = [
  { value: 'column', label: 'Column' },
  { value: 'post', label: 'Post' },
]

/** What an undo puts back: the values a column had. Elevations in mm. */
interface Values {
  designation: string
  rotation: SchedulerRow['rotation']
  column_type: SchedulerRow['column_type']
  bottom_mm: string | null
  top_mm: string | null
}
interface Step {
  label: string
  rows: { id: string; before: Values; after: Values }[]
}

const valuesOf = (r: SchedulerRow): Values => ({
  designation: r.designation,
  rotation: r.rotation,
  column_type: r.column_type,
  bottom_mm: r.bottom_mm,
  top_mm: r.top_mm,
})

/** The changes that take a column from ``from`` to ``to`` (only what differs). */
function changesBetween(from: Values, to: Values): ColumnChanges {
  const changes: ColumnChanges = {}
  if (from.designation !== to.designation) changes.designation = to.designation
  if (from.rotation !== to.rotation) changes.rotation = to.rotation
  if (from.column_type !== to.column_type) changes.column_type = to.column_type
  if (to.bottom_mm !== null && from.bottom_mm !== to.bottom_mm) changes.bottom_mm = `${to.bottom_mm} mm`
  if (to.top_mm !== null && from.top_mm !== to.top_mm) changes.top_mm = `${to.top_mm} mm`
  return changes
}

const describe = (changes: ColumnChanges): string =>
  Object.entries(changes)
    .map(([k, v]) => `${k.replace(/_mm$/, '').replace('_', ' ')} ${v}`)
    .join(', ')

/** The revision's columns as an editable schedule (PRD "Column Scheduler", 22 Oct 2026):
 *  inline edits, Ctrl/Shift multi-select, bulk edits, undo/redo, CSV and Apply to ABM.
 *  Editing a cell of a selected column changes every selected column. */
export function ColumnScheduler({
  projectId,
  wireframeId,
  revisionNo,
  datasetId,
  editable,
  selectedId,
  selection,
  onSelectionChange: setSelection,
  onSelect,
  onChanged,
  grids = [],
  canEditProject = false,
  title,
}: {
  projectId: string
  wireframeId: string
  revisionNo: number
  datasetId: string | null
  editable: boolean
  selectedId: string | null
  /** Columns picked here or in the 3D view (Ctrl+click): shared, so both show them. */
  selection: Set<string>
  onSelectionChange: (selection: Set<string>) => void
  onSelect: (id: string | null) => void
  onChanged: () => void
  /** The revision's grid lines, for the Grid view. */
  grids?: WireframeGrid[]
  /** May name and delete meta-groups (they belong to the project, not the revision). */
  canEditProject?: boolean
  /** Which revision, beside the heading (its own page). */
  title?: string
}) {
  const queryClient = useQueryClient()
  const key = ['wireframe', wireframeId, 'columns']
  const schedule = useQuery({ queryKey: key, queryFn: () => getSchedulerColumns(wireframeId) })
  const anchor = useRef<number | null>(null)
  const [history, setHistory] = useState<{ undo: Step[]; redo: Step[] }>({ undo: [], redo: [] })
  const [error, setError] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)
  const [applied, setApplied] = useState<string | null>(null)
  const rows = useMemo(() => schedule.data?.columns ?? [], [schedule.data])
  // One row per column stack, as the old Wireframer's column groups; opened to its pieces.
  const groups = useMemo(() => groupColumns(rows), [rows])
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const [mode, setMode] = useState<'visual' | 'table' | 'grid'>('table')
  const [search, setSearch] = useState('')
  // The groups the search keeps: a grid, mark, profile or column ID that contains it.
  const listed = useMemo(() => {
    const q = search.trim().toUpperCase().replace(/\s+/g, '')
    if (!q) return groups
    return groups.filter((g) =>
      g.rows.some((r) => [r.grid, r.mark, r.designation, r.id].some((v) => (v ?? '').toUpperCase().replace(/\s+/g, '').includes(q))),
    )
  }, [groups, search])
  // A page of groups at a time (thousands froze the page); the column picked elsewhere turns to its page.
  const focus = useMemo(() => (selectedId ? listed.findIndex((g) => g.rows.some((r) => r.id === selectedId)) : null), [listed, selectedId])
  const view = usePage(listed.length, focus)
  const levels = useMemo(() => schedule.data?.levels ?? [], [schedule.data])

  // Meta-groups: named groups of columns, kept on the project by the columns' members.
  const metaKey = ['column-meta-groups', projectId]
  const metaGroups = useQuery({ queryKey: metaKey, queryFn: () => listColumnMetaGroups(projectId) })
  const createMeta = useMutation({
    mutationFn: (name: string) => createColumnMetaGroup(projectId, name, rows.filter((r) => selection.has(r.id)).map(memberKey)),
    meta: { suppressErrorToast: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: metaKey }),
  })
  const deleteMeta = useMutation({
    mutationFn: (id: string) => deleteColumnMetaGroup(projectId, id),
    meta: { suppressErrorToast: true },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: metaKey }),
  })
  const pickIds = (ids: string[], additive: boolean) => {
    if (additive) {
      const next = new Set(selection)
      const all = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      setSelection(next)
    } else {
      setSelection(new Set(ids))
      onSelect(ids[0] ?? null)
    }
  }

  const edit = useMutation({
    mutationFn: async ({ groups }: { groups: { ids: string[]; changes: ColumnChanges }[]; label: string; record: 'new' | 'undo' | 'redo' }) => {
      let data: SchedulerColumns | undefined
      for (const group of groups) {
        const current = new Map(((data ?? queryClient.getQueryData<SchedulerColumns>(key))?.columns ?? rows).map((r) => [r.id, r]))
        const items = group.ids.map((id) => ({ id, version: current.get(id)!.version }))
        data = await bulkEditColumns(wireframeId, items, group.changes)
      }
      return data!
    },
    onMutate: () => setError(null),
    onSuccess: (data, { groups, label, record }) => {
      const before = new Map(rows.map((r) => [r.id, valuesOf(r)]))
      const after = new Map(data.columns.map((r) => [r.id, r]))
      const ids = groups.flatMap((g) => g.ids)
      const step: Step = {
        label,
        rows: ids.map((id) => ({ id, before: before.get(id)!, after: valuesOf(after.get(id)!) })),
      }
      setHistory((h) =>
        record === 'new'
          ? { undo: [...h.undo, step], redo: [] }
          : record === 'undo'
            ? { undo: h.undo.slice(0, -1), redo: [...h.redo, h.undo[h.undo.length - 1]!] }
            : { undo: [...h.undo, h.redo[h.redo.length - 1]!], redo: h.redo.slice(0, -1) },
      )
      queryClient.setQueryData(key, data)
      onChanged()
    },
    onError: (e) => {
      setError(toApiError(e).message)
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })


  const change = (forRows: SchedulerRow[], changes: ColumnChanges) => {
    if (!Object.keys(changes).length) return
    edit.mutate({
      groups: [{ ids: forRows.map((r) => r.id), changes }],
      label: `${describe(changes)} (${forRows.length} column${forRows.length === 1 ? '' : 's'})`,
      record: 'new',
    })
  }

  /** Put each column of a step back to ``which`` values; columns with the same values go
   *  together. */
  const replay = (step: Step, which: 'before' | 'after', record: 'undo' | 'redo') => {
    const groups = new Map<string, { ids: string[]; changes: ColumnChanges }>()
    for (const row of step.rows) {
      const changes = changesBetween(which === 'before' ? row.after : row.before, row[which])
      if (!Object.keys(changes).length) continue
      const k = JSON.stringify(changes)
      const group = groups.get(k) ?? { ids: [], changes }
      group.ids.push(row.id)
      groups.set(k, group)
    }
    if (groups.size) edit.mutate({ groups: [...groups.values()], label: step.label, record })
  }
  const undo = () => {
    const step = history.undo[history.undo.length - 1]
    if (step && !edit.isPending) replay(step, 'before', 'undo')
  }
  const redo = () => {
    const step = history.redo[history.redo.length - 1]
    if (step && !edit.isPending) replay(step, 'after', 'redo')
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, select, textarea')) return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault()
      undo()
    } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
      e.preventDefault()
      redo()
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      setSelection(new Set(rows.map((r) => r.id)))
    } else if (e.key === 'Escape') setSelection(new Set())
  }

  /** A click on a group's row (``pieceId``: on one of its pieces): selects it, Ctrl+click adds
   *  or removes it, Shift+click selects every group from the last one clicked. */
  const onRowClick = (e: MouseEvent, index: number, pieceId?: string) => {
    if ((e.target as HTMLElement).closest('input, select, button, a')) return
    const ids = pieceId ? [pieceId] : listed[index]!.rows.map((r) => r.id)
    if (e.shiftKey && anchor.current !== null && !pieceId) {
      const [a, b] = [anchor.current, index].sort((x, y) => x - y)
      setSelection(new Set(listed.slice(a, b! + 1).flatMap((g) => g.rows.map((r) => r.id))))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selection)
      const all = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      setSelection(next)
      anchor.current = index
    } else {
      setSelection(new Set(ids))
      anchor.current = index
      onSelect(ids[0]!)
    }
  }

  const toggle = (ids: string[], index: number) => {
    const next = new Set(selection)
    const all = ids.every((id) => next.has(id))
    for (const id of ids) {
      if (all) next.delete(id)
      else next.add(id)
    }
    setSelection(next)
    anchor.current = index
  }

  const toggleOpen = (key: string) =>
    setOpened((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const applyToAbm = useMutation({
    mutationFn: () => applyColumnsToAbm(wireframeId),
    onSuccess: (r) => {
      setApplying(false)
      setApplied(
        `ABM updated: ${r.updated} column entr${r.updated === 1 ? 'y' : 'ies'} changed.` +
          (r.locked ? ` ${r.locked} are on reviewed pages and update once those pages are added.` : '') +
          (r.not_in_abm ? ` ${r.not_in_abm} columns added in the model have no ABM entry.` : ''),
      )
      void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
    },
  })

  // The rows are memoized: give them handlers that keep one identity and reach the latest
  // selection and rows through a ref, so a row re-renders only when its own props change.
  const latest = useRef({ onRowClick, toggle, toggleOpen })
  useLayoutEffect(() => {
    latest.current = { onRowClick, toggle, toggleOpen }
  })
  const actions = useMemo<RowActions>(
    () => ({
      click: (e, index, pieceId) => latest.current.onRowClick(e, index, pieceId),
      toggle: (ids, index) => latest.current.toggle(ids, index),
      open: (key) => latest.current.toggleOpen(key),
    }),
    [],
  )

  if (schedule.isPending) return <LoadingState label="Loading columns…" />
  if (schedule.error) return <p className="field__error">{toApiError(schedule.error).message}</p>

  const selected = rows.filter((r) => selection.has(r.id))
  const metaPanel = (
    <ColumnMetaGroups
      groups={metaGroups.data ?? []}
      rows={rows}
      selection={selection}
      canEdit={canEditProject}
      pending={createMeta.isPending}
      error={createMeta.error || deleteMeta.error ? toApiError(createMeta.error ?? deleteMeta.error).message : null}
      onPick={(ids) => pickIds(ids, false)}
      onCreate={(name) => createMeta.mutate(name)}
      onDelete={(g) => deleteMeta.mutate(g.id)}
    />
  )
  // One column stack picked whole: its bottom is its lowest piece's, its top its highest's.
  const stack = selected.length > 1 ? (groups.find((g) => g.rows.length === selected.length && g.rows.every((r) => selection.has(r.id))) ?? null) : null
  const selectionPanel = (
    <SelectionPanel
      rows={selected}
      stack={stack}
      levels={levels}
      datasetId={datasetId}
      editable={editable}
      pending={edit.isPending}
      onApply={(forRows, changes) => change(forRows, changes)}
      onClear={() => setSelection(new Set())}
    />
  )
  return (
    <div className="col-sched" onKeyDown={onKeyDown}>
      <header className="col-sched__header">
        <div className="col-sched__heading">
          <h1 className="col-sched__title">Column Schedule</h1>
          {title && <span className="col-sched__chip">{title}</span>}
          <span className="col-sched__chip">
            {groups.length.toLocaleString()} group{groups.length === 1 ? '' : 's'} · {rows.length.toLocaleString()} column{rows.length === 1 ? '' : 's'}
          </span>
          {!editable && <span className="col-sched__chip col-sched__chip--muted">Read-only</span>}
        </div>
        <div className="col-sched__actions">
          <div className="family-tabs" role="group" aria-label="Column schedule view">
            {(['table', 'visual', 'grid'] as const).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'visual' ? 'Visual' : m === 'table' ? 'Table' : 'Grid'}
              </button>
            ))}
          </div>
          <Button onClick={() => void downloadColumnsCsv(wireframeId, `columns_r${revisionNo}.csv`)} disabled={!rows.length}>
            Export CSV
          </Button>
          {editable && (
            <Button variant="primary" onClick={() => setApplying(true)} disabled={!rows.length}>
              Apply to ABM…
            </Button>
          )}
        </div>
      </header>
      {applied && (
        <p className="notice notice--compact" role="status">
          {applied}
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
      {!rows.length ? (
        <p className="muted">This revision has no columns.</p>
      ) : mode === 'table' ? (
        <div className="col-sched__layout">
          <section className="col-sched__main" aria-label="Columns">
            <div className="col-sched__toolbar" role="toolbar" aria-label="Column schedule tools">
              {editable && (
                <div className="tool-group">
                  <Button onClick={undo} disabled={!history.undo.length || edit.isPending} title="Undo (Ctrl+Z)">
                    ↶ Undo
                  </Button>
                  <Button onClick={redo} disabled={!history.redo.length || edit.isPending} title="Redo (Ctrl+Y)">
                    ↷ Redo
                  </Button>
                </div>
              )}
              <input
                className="col-sched__search"
                type="search"
                aria-label="Search columns"
                placeholder="Search grid, mark or profile…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Pager label="Column schedule pages" count={listed.length} view={view} />
            </div>
            <div className="table-wrap col-sched__wrap">
              <table className="table table--compact col-sched__table" aria-label="Column schedule" aria-multiselectable="true">
                <thead>
                  <tr>
                    <th scope="col">
                      <input
                        type="checkbox"
                        aria-label="Select all columns"
                        checked={selection.size === rows.length}
                        onChange={(e) => setSelection(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </th>
                    <th scope="col">Column ID</th>
                    <th scope="col">Grid</th>
                    <th scope="col">Mark</th>
                    <th scope="col">Profile</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">
                      Height
                    </th>
                    <th scope="col">Bottom</th>
                    <th scope="col">Top</th>
                    <th scope="col">Rotation</th>
                    <th scope="col" className="num">
                      Members
                    </th>
                    <th scope="col">Page</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.slice(view.start, view.end).map((group, i) => {
                    const index = view.start + i
                    if (group.rows.length === 1) {
                      const row = group.rows[0]!
                      return (
                        <ScheduleRow
                          key={row.id}
                          row={row}
                          index={index}
                          selected={selection.has(row.id)}
                          current={row.id === selectedId}
                          actions={actions}
                          members={1}
                        />
                      )
                    }
                    const open = opened.has(group.key) || group.rows.some((r) => r.id === selectedId)
                    return (
                      <Fragment key={group.key}>
                        <GroupRow group={group} index={index} open={open} selected={group.rows.every((r) => selection.has(r.id))} actions={actions} />
                        {open &&
                          group.rows.map((row) => (
                            <ScheduleRow
                              key={row.id}
                              row={row}
                              index={index}
                              piece
                              selected={selection.has(row.id)}
                              current={row.id === selectedId}
                              actions={actions}
                            />
                          ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
              {!listed.length && <p className="muted col-sched__empty">No column matches “{search}”.</p>}
            </div>
          </section>
          {selectionPanel}
        </div>
      ) : mode === 'visual' ? (
        <ColumnVisual groups={groups} levels={levels} selection={selection} onPick={pickIds} meta={metaPanel} />
      ) : (
        <div className="col-grid__layout">
          <ColumnGridView rows={rows} grids={grids} metaGroups={metaGroups.data ?? []} selection={selection} onPick={pickIds} />
          <div className="col-grid__side">
            {metaPanel}
            {selectionPanel}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={applying}
        title="Apply the columns to the ABM?"
        confirmLabel="Apply to ABM"
        tone="primary"
        pending={applyToAbm.isPending}
        error={applyToAbm.error ? toApiError(applyToAbm.error).message : null}
        onConfirm={() => applyToAbm.mutate()}
        onCancel={() => setApplying(false)}
      >
        <p>
          Each column’s ABM entry takes this revision’s section and height. Those heights are then kept as set here: later level changes no longer
          move them.
        </p>
      </ConfirmDialog>
    </div>
  )
}

/** A text cell saved on Enter or when it loses focus (Escape puts the value back). */

interface RowActions {
  /** ``pieceId``: a piece of an opened group, selected on its own. */
  click: (e: MouseEvent, index: number, pieceId?: string) => void
  toggle: (ids: string[], index: number) => void
  open: (key: string) => void
}

const ROTATION_NAME = (v: SchedulerRow['rotation'] | null) => (v ? (ROTATIONS.find((r) => r.value === v)?.label ?? v) : MIXED)
const TYPE_NAME = (v: SchedulerRow['column_type'] | null) => (v ? (TYPES.find((t) => t.value === v)?.label ?? v) : MIXED)

/** An end of a column as text: its elevation, and the level it is at (smaller). */
function End({ display, level }: { display: string | null; level?: string }) {
  if (!display) return <span className="muted">—</span>
  return (
    <>
      {display}
      {level && <span className="col-sched__level"> {level}</span>}
    </>
  )
}

const ScheduleRow = memo(function ScheduleRow({
  row,
  index,
  selected,
  current,
  actions,
  members,
  piece = false,
}: {
  row: SchedulerRow
  index: number
  selected: boolean
  /** The column shown in the element panel. */
  current: boolean
  actions: RowActions
  /** A group of one: its member count; none for a piece of an opened group. */
  members?: number
  /** One piece of an opened group, under its group's row. */
  piece?: boolean
}) {
  return (
    <tr
      className={piece ? 'col-sched__piece' : undefined}
      aria-selected={selected}
      data-selected={selected || current || undefined}
      onClick={(e) => actions.click(e, index, piece ? row.id : undefined)}
    >
      <td>
        <input
          type="checkbox"
          aria-label={`Select column ${row.mark || row.id.slice(0, 8)}`}
          checked={selected}
          onChange={() => actions.toggle([row.id], index)}
        />
      </td>
      <td className="nowrap col-sched__id" title={row.id}>
        {row.id.slice(0, 8)}
      </td>
      <td className="nowrap">{row.grid || <span className="muted">—</span>}</td>
      <td className="nowrap">{row.mark || <span className="muted">—</span>}</td>
      <td className="nowrap col-sched__profile">{row.designation || <span className="muted">No size</span>}</td>
      <td className="nowrap">{TYPE_NAME(row.column_type)}</td>
      <td className="num nowrap">{row.height_display || <span className="muted">Not placed</span>}</td>
      <td className="nowrap">
        <End display={row.bottom_display} level={row.bottom_level} />
      </td>
      <td className="nowrap">
        <End display={row.top_display} level={row.top_level} />
      </td>
      <td className="nowrap">{ROTATION_NAME(row.rotation)}</td>
      <td className="num">{members ?? ''}</td>
      <td className="nowrap">{row.page_number ? `p.${row.page_number}` : <span className="muted">Added</span>}</td>
    </tr>
  )
})

const MIXED = 'Mixed'

/** A column group (a stack of pieces at one plan position): its lowest bottom, highest top and
 *  what its pieces share; opened to its pieces. */
const GroupRow = memo(function GroupRow({
  group,
  index,
  open,
  selected,
  actions,
}: {
  group: ColumnGroup
  index: number
  open: boolean
  selected: boolean
  actions: RowActions
}) {
  const ids = group.rows.map((r) => r.id)
  const lowest = group.rows[0]!
  const highest = group.rows[group.rows.length - 1]!
  const name = `group ${lowest.id.slice(0, 8)}`
  return (
    <tr className="col-sched__group" aria-selected={selected} data-selected={selected || undefined} onClick={(e) => actions.click(e, index)}>
      <td>
        <input type="checkbox" aria-label={`Select column ${name}`} checked={selected} onChange={() => actions.toggle(ids, index)} />
      </td>
      <td className="nowrap col-sched__id">
        <button type="button" className="link-button" aria-expanded={open} aria-label={`Column ${name}: ${group.rows.length} members`} onClick={() => actions.open(group.key)}>
          <span aria-hidden="true">{open ? '▾' : '▸'} </span>
          {lowest.id.slice(0, 8)}
        </button>
      </td>
      <td className="nowrap">{group.grid || <span className="muted">—</span>}</td>
      <td className="nowrap">{group.mark ?? <span className="muted">{MIXED}</span>}</td>
      <td className="nowrap col-sched__profile">{group.designation ?? <span className="muted">{MIXED}</span>}</td>
      <td className="nowrap">{TYPE_NAME(group.column_type)}</td>
      <td className="num nowrap">{signedFeetInches(group.height_mm) ?? <span className="muted">Not placed</span>}</td>
      <td className="nowrap">
        <End display={lowest.bottom_display} level={lowest.bottom_level} />
      </td>
      <td className="nowrap">
        <End display={highest.top_display} level={highest.top_level} />
      </td>
      <td className="nowrap">{ROTATION_NAME(group.rotation)}</td>
      <td className="num">
        <span className="col-sched__members">{group.rows.length}</span>
      </td>
      <td className="nowrap">{group.pages.map((p) => `p.${p}`).join(', ')}</td>
    </tr>
  )
})

function TextCommit({
  value,
  label,
  onCommit,
  placeholder,
  list,
  onType,
  className = 'col-sched__input',
}: {
  value: string
  label: string
  onCommit: (v: string) => void
  placeholder?: string
  list?: string
  onType?: (v: string) => void
  className?: string
}) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(value)
  }
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim())
  }
  return (
    <input
      className={className}
      aria-label={label}
      value={text}
      list={list}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value)
        onType?.(e.target.value)
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(value)
      }}
    />
  )
}

const COLUMN_SHAPES = ['W', 'HP', 'M', 'S', 'HSS', 'PIPE']

/** A section name, with matching column sections of the project's library to pick from. */
function ProfileInput({
  value,
  datasetId,
  label,
  onCommit,
  placeholder = 'e.g. W14X99',
}: {
  value: string
  datasetId: string | null
  label: string
  onCommit: (v: string) => void
  placeholder?: string
}) {
  const listId = useId()
  const [typed, setTyped] = useState('')
  const search = useDebouncedValue(typed.trim())
  const found = useQuery({
    queryKey: ['section-profiles', datasetId, search],
    queryFn: () => searchProfiles(datasetId!, search),
    enabled: Boolean(datasetId) && search.length >= 2,
  })
  const columnShapes = (found.data ?? []).filter((p) => COLUMN_SHAPES.includes(p.family.toUpperCase()))
  return (
    <>
      <TextCommit value={value} label={label} placeholder={placeholder} list={listId} onType={setTyped} onCommit={onCommit} />
      <datalist id={listId}>
        {columnShapes.slice(0, 30).map((p) => (
          <option key={p.id} value={p.designation} />
        ))}
      </datalist>
    </>
  )
}

/** What the selected columns share (null: they differ). */
const sharedValue = <T,>(rows: SchedulerRow[], pick: (r: SchedulerRow) => T): T | null => {
  const first = pick(rows[0]!)
  return rows.every((r) => pick(r) === first) ? first : null
}

/** The selection's values, edited in a side panel as on the extraction page: each change is
 *  saved at once for every selected column. A whole column stack keeps its pieces: its bottom
 *  is its lowest piece's, its top its highest's. */
function SelectionPanel({
  rows,
  stack,
  levels,
  datasetId,
  editable,
  pending,
  onApply,
  onClear,
}: {
  rows: SchedulerRow[]
  stack: ColumnGroup | null
  levels: SchedulerLevel[]
  datasetId: string | null
  editable: boolean
  pending: boolean
  onApply: (rows: SchedulerRow[], changes: ColumnChanges) => void
  onClear: () => void
}) {
  if (!rows.length) {
    return (
      <aside className="col-sched__panel" aria-label="Selected columns">
        <h2 className="col-sched__panel-title">Selection</h2>
        <p className="muted">Pick a column or a column group to see and change its values.</p>
        <ul className="col-sched__tips muted">
          <li>Ctrl+click adds a row, Shift+click picks a range.</li>
          <li>A change here applies to every selected column.</li>
          <li>Ctrl+Z / Ctrl+Y undo and redo.</li>
        </ul>
      </aside>
    )
  }
  const one = rows.length === 1 ? rows[0]! : null
  const bottomRows = stack ? [stack.rows[0]!] : rows
  const topRows = stack ? [stack.rows[stack.rows.length - 1]!] : rows
  const placed = rows.every((r) => r.bottom_mm !== null)
  const control = 'field__control field__control--compact'
  const end = (which: 'bottom' | 'top') => {
    const targets = which === 'bottom' ? bottomRows : topRows
    const display = sharedValue(targets, (r) => (which === 'bottom' ? r.bottom_display : r.top_display))
    const level = sharedValue(targets, (r) => (which === 'bottom' ? r.bottom_level : r.top_level))
    const name = which === 'bottom' ? 'Bottom' : 'Top'
    return (
      <div className="col-quick__field">
        <span className="col-quick__label">
          {name}
          {stack && <span className="muted"> ({which === 'bottom' ? 'lowest' : 'highest'} piece)</span>}
        </span>
        <div className="col-quick__pair">
          <TextCommit
            className={control}
            value={display ?? ''}
            placeholder={display === null ? MIXED : undefined}
            label={`${name} elevation of the selection`}
            onCommit={(v) => onApply(targets, which === 'bottom' ? { bottom_mm: v } : { top_mm: v })}
          />
          <select
            className={control}
            aria-label={`${name} level of the selection`}
            value={level ?? ''}
            onChange={(e) => e.target.value && onApply(targets, which === 'bottom' ? { bottom_level: e.target.value } : { top_level: e.target.value })}
          >
            <option value="">{level === null ? MIXED : level ? '' : 'Level…'}</option>
            {levels.map((l) => (
              <option key={l.label} value={l.label}>
                {l.label} ({l.elevation_display})
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }
  const designation = sharedValue(rows, (r) => r.designation)
  const columnType = sharedValue(rows, (r) => r.column_type)
  const rotation = sharedValue(rows, (r) => r.rotation)
  const height = sharedValue(rows, (r) => r.height_display)
  return (
    <aside className="col-sched__panel" aria-label="Selected columns">
      <header className="col-sched__panel-head">
        <h2 className="col-sched__panel-title">
          {one ? `Column ${one.mark || one.id.slice(0, 8)}` : stack ? `Column group · ${rows.length} pieces` : `${rows.length} columns selected`}
        </h2>
        <Button onClick={onClear}>Clear</Button>
      </header>
      <div className="col-sched__panel-chips">
        {(one?.grid || stack?.grid) && <span className="col-quick__chip">Grid {one?.grid || stack?.grid}</span>}
        {one?.page_number && <span className="col-quick__chip">p.{one.page_number}</span>}
        {one && <span className="col-quick__chip col-sched__id">{one.id.slice(0, 8)}</span>}
      </div>
      <fieldset className="col-quick__fields" disabled={!editable || pending}>
        <legend className="visually-hidden">Values of the selected columns</legend>
        <div className="col-quick__field">
          <span className="col-quick__label">Profile</span>
          <ProfileInput
            value={designation ?? ''}
            placeholder={designation === null ? MIXED : 'e.g. W14X99'}
            datasetId={datasetId}
            label="Profile of the selection"
            onCommit={(v) => onApply(rows, { designation: v })}
          />
        </div>
        <div className="col-quick__pair">
          <div className="col-quick__field">
            <span className="col-quick__label">Type</span>
            <select
              className={control}
              aria-label="Type of the selection"
              value={columnType ?? ''}
              onChange={(e) => e.target.value && onApply(rows, { column_type: e.target.value as SchedulerRow['column_type'] })}
            >
              {columnType === null && <option value="">{MIXED}</option>}
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-quick__field">
            <span className="col-quick__label">Rotation</span>
            <select
              className={control}
              aria-label="Rotation of the selection"
              value={rotation ?? ''}
              onChange={(e) => e.target.value && onApply(rows, { rotation: e.target.value as SchedulerRow['rotation'] })}
            >
              {rotation === null && <option value="">{MIXED}</option>}
              {ROTATIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!stack && (
          <div className="col-quick__field">
            <span className="col-quick__label">Height</span>
            <TextCommit
              className={control}
              value={height ?? ''}
              placeholder={height === null ? MIXED : undefined}
              label="Height of the selection"
              onCommit={(v) => onApply(rows, { height_mm: v })}
            />
            <span className="col-quick__hint">Changing the height moves the top.</span>
          </div>
        )}
        {end('top')}
        {end('bottom')}
      </fieldset>
      {!placed && <p className="muted col-quick__hint">Some are not placed yet: their ends can be set once their levels are.</p>}
      {!editable && <p className="muted col-quick__hint">This revision is read-only.</p>}
    </aside>
  )
}

/** The column's own values in its properties panel: height, top, bottom, rotation and type.
 *  Each change is saved at once (as in the schedule) and shows in the 3D view. */
export function ColumnQuickEdit({
  wireframeId,
  row,
  levels,
  editable,
  onChanged,
}: {
  wireframeId: string
  row: SchedulerRow
  levels: SchedulerLevel[]
  editable: boolean
  onChanged: () => void
}) {
  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (changes: ColumnChanges) => bulkEditColumns(wireframeId, [{ id: row.id, version: row.version }], changes),
    meta: { suppressErrorToast: true },
    onSuccess: (data) => {
      queryClient.setQueryData(['wireframe', wireframeId, 'columns'], data)
      onChanged()
    },
  })
  const id = row.id.slice(0, 8)
  const control = 'field__control field__control--compact'
  const end = (which: 'bottom' | 'top') => {
    const display = which === 'bottom' ? row.bottom_display : row.top_display
    const level = which === 'bottom' ? row.bottom_level : row.top_level
    const placed = (which === 'bottom' ? row.bottom_mm : row.top_mm) !== null
    const name = which === 'bottom' ? 'Bottom' : 'Top'
    return (
      <div className="col-quick__field">
        <span className="col-quick__label">{name}</span>
        <div className="col-quick__pair">
          <TextCommit
            className={control}
            value={display}
            label={`${name} elevation of ${id}`}
            onCommit={(v) => save.mutate(which === 'bottom' ? { bottom_mm: v } : { top_mm: v })}
          />
          <select
            className={control}
            aria-label={`${name} level of ${id}`}
            value={level}
            disabled={!placed}
            onChange={(e) => e.target.value && save.mutate(which === 'bottom' ? { bottom_level: e.target.value } : { top_level: e.target.value })}
          >
            <option value="">{level ? '' : 'Level…'}</option>
            {levels.map((l) => (
              <option key={l.label} value={l.label} title={`${l.label} at ${l.elevation_display}`}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    )
  }
  return (
    <section className="col-quick" aria-label="Column">
      <header className="col-quick__header">
        <strong>Column</strong>
        {row.mark && <span className="col-quick__chip">Mark {row.mark}</span>}
        {row.grid && <span className="col-quick__chip">Grid {row.grid}</span>}
      </header>
      <fieldset className="col-quick__fields" disabled={!editable || save.isPending || row.bottom_mm === null}>
        <legend className="visually-hidden">Column values</legend>
        <div className="col-quick__field">
          <span className="col-quick__label">Height</span>
          <TextCommit className={control} value={row.height_display} label={`Height of ${id}`} onCommit={(v) => save.mutate({ height_mm: v })} />
          <span className="col-quick__hint">Changing the height moves the top.</span>
        </div>
        {end('top')}
        {end('bottom')}
        <div className="col-quick__pair">
          <div className="col-quick__field">
            <span className="col-quick__label">Rotation</span>
            <select
              className={control}
              aria-label={`Rotation of ${id}`}
              value={row.rotation}
              onChange={(e) => save.mutate({ rotation: e.target.value as SchedulerRow['rotation'] })}
            >
              {ROTATIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="col-quick__field">
            <span className="col-quick__label">Type</span>
            <select
              className={control}
              aria-label={`Type of ${id}`}
              value={row.column_type}
              onChange={(e) => save.mutate({ column_type: e.target.value as SchedulerRow['column_type'] })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>
      {row.bottom_mm === null && <p className="muted col-quick__hint">Not placed yet: its height and ends can be set once its levels are.</p>}
      {save.error && <p className="field__error">{toApiError(save.error).message}</p>}
    </section>
  )
}

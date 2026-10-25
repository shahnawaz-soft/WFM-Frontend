import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'

import { toApiError } from '../../api/errors'
import { searchProfiles } from '../../api/sections'
import type { ColumnChanges, SchedulerColumns, SchedulerLevel, SchedulerRow } from '../../api/types'
import { applyColumnsToAbm, bulkEditColumns, downloadColumnsCsv, getSchedulerColumns } from '../../api/wireframe'
import { LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

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
  wireframeId,
  revisionNo,
  datasetId,
  editable,
  selectedId,
  selection,
  onSelectionChange: setSelection,
  onSelect,
  onChanged,
}: {
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
  const levels = schedule.data?.levels ?? []

  const edit = useMutation({
    mutationFn: async ({ groups }: { groups: { ids: string[]; changes: ColumnChanges }[]; label: string; record: 'new' | 'undo' | 'redo' }) => {
      let data: SchedulerColumns | undefined
      for (const group of groups) {
        const current = (data ?? queryClient.getQueryData<SchedulerColumns>(key))?.columns ?? rows
        const items = group.ids.map((id) => ({ id, version: current.find((r) => r.id === id)!.version }))
        data = await bulkEditColumns(wireframeId, items, group.changes)
      }
      return data!
    },
    onMutate: () => setError(null),
    onSuccess: (data, { groups, label, record }) => {
      const before = new Map(rows.map((r) => [r.id, valuesOf(r)]))
      const ids = groups.flatMap((g) => g.ids)
      const step: Step = {
        label,
        rows: ids.map((id) => ({ id, before: before.get(id)!, after: valuesOf(data.columns.find((r) => r.id === id)!) })),
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

  const targets = (row: SchedulerRow): SchedulerRow[] =>
    selection.has(row.id) && selection.size > 1 ? rows.filter((r) => selection.has(r.id)) : [row]

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

  const onRowClick = (e: MouseEvent, index: number) => {
    if ((e.target as HTMLElement).closest('input, select, button, a')) return
    const id = rows[index]!.id
    if (e.shiftKey && anchor.current !== null) {
      const [a, b] = [anchor.current, index].sort((x, y) => x - y)
      setSelection(new Set(rows.slice(a, b! + 1).map((r) => r.id)))
    } else if (e.ctrlKey || e.metaKey) {
      const next = new Set(selection)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelection(next)
      anchor.current = index
    } else {
      setSelection(new Set([id]))
      anchor.current = index
      onSelect(id)
    }
  }

  const toggle = (id: string, index: number) => {
    const next = new Set(selection)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelection(next)
    anchor.current = index
  }

  const applyToAbm = useMutation({
    mutationFn: () => applyColumnsToAbm(wireframeId),
    onSuccess: (r) => {
      setApplying(false)
      setApplied(
        `ABM updated: ${r.updated} column entr${r.updated === 1 ? 'y' : 'ies'} changed.` +
          (r.locked ? ` ${r.locked} are on reviewed pages and update once those pages are added.` : '') +
          (r.not_in_abm ? ` ${r.not_in_abm} columns added in the model have no ABM entry.` : ''),
      )
      void queryClient.invalidateQueries({ queryKey: ['abm'] })
    },
  })

  if (schedule.isPending) return <LoadingState label="Loading columns…" />
  if (schedule.error) return <p className="field__error">{toApiError(schedule.error).message}</p>

  const selected = rows.filter((r) => selection.has(r.id))
  return (
    <div className="col-sched" onKeyDown={onKeyDown}>
      <div className="button-row button-row--tight col-sched__tools">
        {editable && (
          <>
            <Button onClick={undo} disabled={!history.undo.length || edit.isPending} title="Undo (Ctrl+Z)">
              ↶ Undo
            </Button>
            <Button onClick={redo} disabled={!history.redo.length || edit.isPending} title="Redo (Ctrl+Y)">
              ↷ Redo
            </Button>
          </>
        )}
        <Button onClick={() => void downloadColumnsCsv(wireframeId, `columns_r${revisionNo}.csv`)} disabled={!rows.length}>
          Export CSV
        </Button>
        {editable && (
          <Button variant="primary" onClick={() => setApplying(true)} disabled={!rows.length}>
            Apply to ABM…
          </Button>
        )}
        <span className="muted col-sched__hint">
          {editable
            ? 'Click a row to select it, Ctrl+click to add to the selection, Shift+click for a range. Editing a selected row changes every selected column.'
            : 'This revision is read-only.'}
        </span>
      </div>
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
      {editable && selected.length > 1 && (
        <BulkBar
          rows={selected}
          levels={levels}
          datasetId={datasetId}
          pending={edit.isPending}
          onApply={(changes) => change(selected, changes)}
          onClear={() => setSelection(new Set())}
        />
      )}
      {!rows.length ? (
        <p className="muted">This revision has no columns.</p>
      ) : (
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
                <th scope="col">Grid</th>
                <th scope="col">Mark</th>
                <th scope="col">Column ID</th>
                <th scope="col">Profile</th>
                <th scope="col">Type</th>
                <th scope="col">Height</th>
                <th scope="col">Bottom</th>
                <th scope="col">Top</th>
                <th scope="col">Rotation</th>
                <th scope="col">Page</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr
                  key={row.id}
                  aria-selected={selection.has(row.id)}
                  data-selected={selection.has(row.id) || row.id === selectedId || undefined}
                  onClick={(e) => onRowClick(e, index)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select column ${row.mark || row.id.slice(0, 8)}`}
                      checked={selection.has(row.id)}
                      onChange={() => toggle(row.id, index)}
                    />
                  </td>
                  <td className="nowrap">{row.grid || <span className="muted">—</span>}</td>
                  <td className="nowrap">{row.mark || <span className="muted">—</span>}</td>
                  <td className="nowrap col-sched__id" title={row.id}>
                    {row.id.slice(0, 8)}
                  </td>
                  <td>
                    {editable ? (
                      <ProfileInput
                        value={row.designation}
                        datasetId={datasetId}
                        label={`Profile of ${row.id.slice(0, 8)}`}
                        onCommit={(v) => change(targets(row), { designation: v })}
                      />
                    ) : (
                      row.designation || <span className="muted">Size not given</span>
                    )}
                  </td>
                  <td>
                    {editable ? (
                      <select
                        aria-label={`Type of ${row.id.slice(0, 8)}`}
                        value={row.column_type}
                        onChange={(e) => change(targets(row), { column_type: e.target.value as SchedulerRow['column_type'] })}
                      >
                        {TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      TYPES.find((t) => t.value === row.column_type)?.label
                    )}
                  </td>
                  <td className="nowrap">
                    {editable && row.bottom_mm !== null ? (
                      <TextCommit
                        value={row.height_display}
                        label={`Height of ${row.id.slice(0, 8)}`}
                        onCommit={(v) => change(targets(row), { height_mm: v })}
                      />
                    ) : (
                      row.height_display || <span className="muted">Not placed</span>
                    )}
                  </td>
                  <td className="nowrap">
                    <EndCell
                      row={row}
                      which="bottom"
                      levels={levels}
                      editable={editable && row.bottom_mm !== null}
                      onCommit={(changes) => change(targets(row), changes)}
                    />
                  </td>
                  <td className="nowrap">
                    <EndCell
                      row={row}
                      which="top"
                      levels={levels}
                      editable={editable && row.top_mm !== null}
                      onCommit={(changes) => change(targets(row), changes)}
                    />
                  </td>
                  <td>
                    {editable ? (
                      <select
                        aria-label={`Rotation of ${row.id.slice(0, 8)}`}
                        value={row.rotation}
                        onChange={(e) => change(targets(row), { rotation: e.target.value as SchedulerRow['rotation'] })}
                      >
                        {ROTATIONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      ROTATIONS.find((r) => r.value === row.rotation)?.label
                    )}
                  </td>
                  <td className="nowrap">{row.page_number ? `p.${row.page_number}` : <span className="muted">Added</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
function ProfileInput({ value, datasetId, label, onCommit }: { value: string; datasetId: string | null; label: string; onCommit: (v: string) => void }) {
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
      <TextCommit value={value} label={label} placeholder="e.g. W14X99" list={listId} onType={setTyped} onCommit={onCommit} />
      <datalist id={listId}>
        {columnShapes.slice(0, 30).map((p) => (
          <option key={p.id} value={p.designation} />
        ))}
      </datalist>
    </>
  )
}

/** Bottom or top of a column: its elevation, and the level it snaps to. */
function EndCell({
  row,
  which,
  levels,
  editable,
  onCommit,
}: {
  row: SchedulerRow
  which: 'bottom' | 'top'
  levels: SchedulerLevel[]
  editable: boolean
  onCommit: (changes: ColumnChanges) => void
}) {
  const display = which === 'bottom' ? row.bottom_display : row.top_display
  const level = which === 'bottom' ? row.bottom_level : row.top_level
  if (!editable) {
    return display ? (
      <>
        {display}
        {level && <span className="muted"> · {level}</span>}
      </>
    ) : (
      <span className="muted">—</span>
    )
  }
  const id = row.id.slice(0, 8)
  return (
    <span className="col-sched__end">
      <TextCommit
        value={display}
        label={`${which === 'bottom' ? 'Bottom' : 'Top'} elevation of ${id}`}
        onCommit={(v) => onCommit(which === 'bottom' ? { bottom_mm: v } : { top_mm: v })}
      />
      <select
        aria-label={`${which === 'bottom' ? 'Bottom' : 'Top'} level of ${id}`}
        value={level}
        onChange={(e) => e.target.value && onCommit(which === 'bottom' ? { bottom_level: e.target.value } : { top_level: e.target.value })}
      >
        <option value="">{level ? '' : 'Level…'}</option>
        {levels.map((l) => (
          <option key={l.label} value={l.label}>
            {l.label} ({l.elevation_display})
          </option>
        ))}
      </select>
    </span>
  )
}

/** Set one value on every selected column. */
function BulkBar({
  rows,
  levels,
  datasetId,
  pending,
  onApply,
  onClear,
}: {
  rows: SchedulerRow[]
  levels: SchedulerLevel[]
  datasetId: string | null
  pending: boolean
  onApply: (changes: ColumnChanges) => void
  onClear: () => void
}) {
  const [values, setValues] = useState<ColumnChanges>({})
  const set = (k: keyof ColumnChanges, v: string) =>
    setValues((s) => {
      const next = { ...s }
      if (v) (next as Record<string, string>)[k] = v
      else delete next[k]
      return next
    })
  return (
    <div className="col-sched__bulk" role="group" aria-label="Change the selected columns">
      <strong>{rows.length} columns selected</strong>
      <ProfileInput value={values.designation ?? ''} datasetId={datasetId} label="Profile for the selected columns" onCommit={(v) => set('designation', v)} />
      <select aria-label="Type for the selected columns" value={values.column_type ?? ''} onChange={(e) => set('column_type', e.target.value)}>
        <option value="">Type…</option>
        {TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <select aria-label="Rotation for the selected columns" value={values.rotation ?? ''} onChange={(e) => set('rotation', e.target.value)}>
        <option value="">Rotation…</option>
        {ROTATIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <select aria-label="Bottom level for the selected columns" value={values.bottom_level ?? ''} onChange={(e) => set('bottom_level', e.target.value)}>
        <option value="">Bottom level…</option>
        {levels.map((l) => (
          <option key={l.label} value={l.label}>
            {l.label}
          </option>
        ))}
      </select>
      <select aria-label="Top level for the selected columns" value={values.top_level ?? ''} onChange={(e) => set('top_level', e.target.value)}>
        <option value="">Top level…</option>
        {levels.map((l) => (
          <option key={l.label} value={l.label}>
            {l.label}
          </option>
        ))}
      </select>
      <TextCommit value={values.height_mm ?? ''} label="Height for the selected columns" placeholder={'Height, e.g. 14\'-0"'} onCommit={(v) => set('height_mm', v)} />
      <Button
        variant="primary"
        loading={pending}
        disabled={!Object.keys(values).length}
        onClick={() => {
          onApply(values)
          setValues({})
        }}
      >
        Apply to {rows.length}
      </Button>
      <Button onClick={onClear}>Clear selection</Button>
    </div>
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

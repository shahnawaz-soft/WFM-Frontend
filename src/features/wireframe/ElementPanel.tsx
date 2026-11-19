import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import { toApiError } from '../../api/errors'
import type { SchedulerLevel, SchedulerRow, WireframeElement, WireframeGrid } from '../../api/types'
import { addElement, editElement, removeElement, type Point } from '../../api/wireframe'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { signedFeetInches } from '../abm/format'
import { ColumnQuickEdit } from './ColumnScheduler'
import { gridPoint, nearestGrid, parseFeetInches, straightGrids, type GridOffset } from './gridPosition'

const AXES = ['x', 'y', 'z'] as const
const PROVENANCE: Record<string, string> = { generated: 'Generated', edited: 'Edited', added: 'Added by hand' }

type PointText = [string, string, string]
const asText = (p: string[] | null): PointText => (p ? (p.map((v) => signedFeetInches(v) ?? '') as PointText) : ['', '', ''])
const filled = (p: PointText) => p.every((v) => v.trim() !== '')

/** Place a point by grid crossing and offsets ("B, -2'-6"" / "2, 0"), as the old Wireframer did:
 *  it fills the point's x and y; z stays as typed. */
function GridPlacer({ legend, grids, value, onPlace }: { legend: string; grids: WireframeGrid[]; value: PointText; onPlace: (x: string, y: string) => void }) {
  const near = (direction: 'x' | 'y', text: string): GridOffset => {
    const mm = parseFeetInches(text)
    return nearestGrid(grids, direction, text.trim() === '' || mm === null ? null : String(mm))
  }
  const [open, setOpen] = useState(false)
  const [x, setX] = useState<GridOffset>(() => near('x', value[0]))
  const [y, setY] = useState<GridOffset>(() => near('y', value[1]))
  const [problem, setProblem] = useState('')
  const options = (direction: 'x' | 'y') => [
    { value: '', label: '—' },
    ...straightGrids(grids, direction).map((g) => ({ value: g.label, label: g.label })),
  ]
  function place() {
    const found = gridPoint(grids, x, y)
    if (typeof found === 'string') return setProblem(found)
    setProblem('')
    onPlace(found[0], found[1])
  }
  if (!open) {
    return (
      <Button className="grid-placer__open" onClick={() => {
        setX(near('x', value[0]))
        setY(near('y', value[1]))
        setOpen(true)
      }}>
        Place {legend.toLowerCase()} by grid
      </Button>
    )
  }
  return (
    <div className="grid-placer" role="group" aria-label={`${legend} by grid`}>
      <SelectField label={`${legend} X grid`} value={x.label} options={options('x')} onChange={(e) => setX((v) => ({ ...v, label: e.target.value }))} />
      <TextField label={`${legend} X offset`} value={x.offset} onChange={(e) => setX((v) => ({ ...v, offset: e.target.value }))} hint={`Right of the grid; e.g. 2'-6" or -1'-0"`} />
      <SelectField label={`${legend} Y grid`} value={y.label} options={options('y')} onChange={(e) => setY((v) => ({ ...v, label: e.target.value }))} />
      <TextField label={`${legend} Y offset`} value={y.offset} onChange={(e) => setY((v) => ({ ...v, offset: e.target.value }))} hint="Above the grid" />
      {problem && <p className="field__error">{problem}</p>}
      <div className="button-row button-row--tight">
        <Button onClick={place}>Use this point</Button>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </div>
    </div>
  )
}

function PointFields({
  legend,
  value,
  onChange,
  errors,
  grids = [],
  onPlace,
}: {
  legend: string
  value: PointText
  onChange: (p: PointText) => void
  errors?: string[]
  grids?: WireframeGrid[]
  /** Placing by grid fills x and y (default: this point's). */
  onPlace?: (x: string, y: string) => void
}) {
  const hasGrids = straightGrids(grids, 'x').length > 0 && straightGrids(grids, 'y').length > 0
  return (
    <fieldset className="point-fields">
      <legend>{legend}</legend>
      {AXES.map((axis, i) => (
        <TextField
          key={axis}
          label={`${legend} ${axis}`}
          value={value[i]}
          onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)) as PointText)}
        />
      ))}
      {errors && <p className="field__error">{errors.join(' ')}</p>}
      {hasGrids && (
        <GridPlacer legend={legend} grids={grids} value={value} onPlace={onPlace ?? ((x, y) => onChange([x, y, value[2]]))} />
      )}
    </fieldset>
  )
}

interface ElementPanelProps {
  projectId: string
  element: WireframeElement
  editable: boolean
  /** A column: its schedule row and the levels, for its height, top, bottom and rotation. */
  column?: { wireframeId: string; row: SchedulerRow; levels: SchedulerLevel[] } | null
  /** ``null``: removed (or, with ``keep``, changed elsewhere: reload it and keep it open). */
  onChanged: (element: WireframeElement | null, keep?: boolean) => void
  onStale: () => void
  onClose: () => void
  /** The project's grid lines: a point may be placed by grid crossing and offset. */
  grids?: WireframeGrid[]
}

/** One element: what it is, where it came from, and (on the editable revision) its values. */
export function ElementPanel({ projectId, element, editable, column, onChanged, onStale, onClose, grids = [] }: ElementPanelProps) {
  const [form, setForm] = useState({
    element_type: element.element_type,
    designation: element.designation,
    level_label: element.level_label,
    start: asText(element.start),
    end: asText(element.end),
    reason: '',
  })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      const moved = JSON.stringify([form.start, form.end]) !== JSON.stringify([asText(element.start), asText(element.end)])
      return editElement(element.id, element.version, {
        element_type: form.element_type,
        designation: form.designation,
        level_label: form.level_label,
        reason: form.reason,
        ...(moved && filled(form.start) && filled(form.end) ? { start: form.start as Point, end: form.end as Point } : {}),
      })
    },
    meta: { suppressErrorToast: true },
    onSuccess: (updated) => {
      setErrors(NO_ERRORS)
      setSaved(true)
      onChanged(updated)
    },
    onError: (error) => {
      setErrors(toFormErrors(error))
      if (toApiError(error).code === 'stale_version') onStale()
    },
  })
  const remove = useMutation({
    mutationFn: () => removeElement(element.id, element.version, form.reason),
    meta: { successMessage: 'Element removed' },
    onSuccess: () => onChanged(null),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    save.mutate()
  }

  const title = `${element.element_type === 'column' ? 'Column' : 'Beam'} ${element.designation || '(size not on plan)'}`
  return (
    <section className="member-editor element-panel" aria-labelledby="element-panel-title">
      <div className="member-editor__header">
        <h3 id="element-panel-title">{title}</h3>
        <Button onClick={onClose} aria-label="Close element details">
          ×
        </Button>
      </div>
      <p className="member-editor__meta">
        <StatusBadge
          tone={element.completeness === 'ok' ? 'success' : element.completeness === 'unsupported' ? 'neutral' : 'warning'}
          label={
            element.completeness === 'ok'
              ? 'Placed'
              : element.issues.includes('same_column')
                ? 'Drawn from another plan'
                : element.completeness === 'unsupported'
                  ? 'Not in 3D'
                  : 'Missing data'
          }
        />
        <span className="muted">{PROVENANCE[element.provenance] ?? element.provenance}</span>
        {element.source_page && (
          <Link to={`/projects/${projectId}/pages/${element.source_page}${element.source_member ? `?member=${element.source_member}` : ''}`}>
            Show on plan (p.{element.page_number})
          </Link>
        )}
      </p>
      {element.issue_messages.length > 0 && <p className="muted element-panel__notes">{element.issue_messages.join(' ')}</p>}
      {saved && (
        <p className="member-editor__note" role="status">
          Changes saved
        </p>
      )}
      {column && (
        <ColumnQuickEdit wireframeId={column.wireframeId} row={column.row} levels={column.levels} editable={editable} onChanged={() => onChanged(null, true)} />
      )}
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <fieldset disabled={!editable || save.isPending} className="element-panel__fields">
          <legend className="visually-hidden">Element values</legend>
          <SelectField
            label="Type"
            value={form.element_type}
            onChange={(e) => setForm((f) => ({ ...f, element_type: e.target.value as 'beam' | 'column' }))}
            options={[
              { value: 'beam', label: 'Beam' },
              { value: 'column', label: 'Column' },
            ]}
          />
          <TextField label="Section" value={form.designation} placeholder="e.g. W14X90" onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} error={errors.fields.designation} />
          <TextField label="Level" value={form.level_label} onChange={(e) => setForm((f) => ({ ...f, level_label: e.target.value }))} />
          <PointFields legend="Start" value={form.start} onChange={(start) => setForm((f) => ({ ...f, start }))} errors={errors.fields.start} grids={grids} />
          <PointFields legend="End" value={form.end} onChange={(end) => setForm((f) => ({ ...f, end }))} errors={errors.fields.end} grids={grids} />
          <p className="muted element-panel__hint">Distances from the reference grid point; type feet-inches (12'-6") or mm.</p>
          <TextField label="Reason / note" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} hint="Optional. Saved in the history." />
        </fieldset>
        {editable && (
          <div className="button-row button-row--tight">
            <Button type="submit" variant="primary" loading={save.isPending}>
              Save changes
            </Button>
            <Button variant="danger" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        )}
      </form>
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this element?"
        confirmLabel="Remove element"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => setConfirmRemove(false)}
      >
        <p>It is taken out of this revision. The removal (and your note) is kept in the project history.</p>
      </ConfirmDialog>
    </section>
  )
}

/** Add a beam or column by its two ends. */
export function AddElementForm({
  wireframeId,
  onAdded,
  onCancel,
  grids = [],
}: {
  wireframeId: string
  onAdded: (e: WireframeElement) => void
  onCancel: () => void
  grids?: WireframeGrid[]
}) {
  const [form, setForm] = useState({ element_type: 'column' as 'beam' | 'column', designation: '', level_label: '', start: ['', '', ''] as PointText, end: ['', '', ''] as PointText })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const add = useMutation({
    mutationFn: () => addElement(wireframeId, { ...form, start: form.start as Point, end: form.end as Point }),
    meta: { suppressErrorToast: true, successMessage: 'Element added' },
    onSuccess: onAdded,
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!filled(form.start) || !filled(form.end)) return setErrors({ form: 'Give x, y and z for both ends.', fields: {} })
    add.mutate()
  }
  return (
    <section className="member-editor element-panel" aria-labelledby="add-element-title">
      <h3 id="add-element-title">Add an element</h3>
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <div className="element-panel__fields">
          <SelectField
            label="Type"
            value={form.element_type}
            onChange={(e) => setForm((f) => ({ ...f, element_type: e.target.value as 'beam' | 'column' }))}
            options={[
              { value: 'column', label: 'Column' },
              { value: 'beam', label: 'Beam' },
            ]}
          />
          <TextField label="Section" value={form.designation} placeholder="e.g. W14X90" onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))} />
          <TextField label="Level" value={form.level_label} onChange={(e) => setForm((f) => ({ ...f, level_label: e.target.value }))} />
          <PointFields
            legend="Start"
            value={form.start}
            onChange={(start) => setForm((f) => ({ ...f, start }))}
            errors={errors.fields.start}
            grids={grids}
            // A column stands at one crossing: its top takes the same x and y.
            onPlace={(x, y) =>
              setForm((f) => ({ ...f, start: [x, y, f.start[2]], end: f.element_type === 'column' ? [x, y, f.end[2]] : f.end }))
            }
          />
          <PointFields legend="End" value={form.end} onChange={(end) => setForm((f) => ({ ...f, end }))} errors={errors.fields.end} grids={grids} />
        </div>
        <div className="button-row button-row--tight">
          <Button type="submit" variant="primary" loading={add.isPending}>
            Add element
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

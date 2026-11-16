import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { toApiError } from '../../api/errors'
import { changePageGrid, gridEditsOf, type PageGridEdits, type PageGridInput } from '../../api/processing'
import type { DrawingPage, GridLine } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { kindOf, seenDirection, seenOrientation, seenSlope, slopeGroups, slopeOf, SLOPE_TOLERANCE, type GridForm } from './gridForm'

interface GridDialogProps {
  page: DrawingPage
  grids: GridLine[]
  /** The point clicked on the sheet (PDF points). */
  point: [number, number]
  /** The grid being edited (its label), or null when adding one. */
  editing: string | null
  form: GridForm
  onForm: (form: GridForm) => void
  /** Hidden while the person picks the second point of a slope. */
  hidden: boolean
  onPickSlope: () => void
  /** The page's grid edits before this change (for Undo), once saved. */
  onSaved: (before: PageGridEdits, message: string) => void
  onClose: () => void
}

/** "Add Grid Line" / "Edit Grid Line", as the old Wireframer's: label, orientation, base grid,
 *  reference grid and the distance from it (ft-in, + or -); a diagonal's slope from an existing
 *  group, typed, or picked from two points. Shown at once; the page runs again when asked. */
export function GridDialog({ page, grids, point, editing, form, onForm, hidden, onPickSlope, onSaved, onClose }: GridDialogProps) {
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [reviewWarning, setReviewWarning] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (changes: Partial<GridForm>) => onForm({ ...form, ...changes })
  const rotation = page.rotation
  const groups = slopeGroups(grids)
  const diagonal = form.orientation === 'diagonal'
  const groupSlope = form.group ? Number(form.group) : null
  const references = grids.filter((g) => {
    if (g.label === editing || g.label === form.label || g.arc) return false
    if (!diagonal) return seenOrientation(kindOf(g), rotation) === form.orientation
    const slope = slopeOf(g)
    return groupSlope !== null && slope !== null && kindOf(g) === 'diagonal' && Math.abs(slope - groupSlope) <= SLOPE_TOLERANCE
  })
  const before = gridEditsOf(page.grid_edits)

  const save = useMutation({
    mutationFn: ({ action, discardReview }: { action: 'add' | 'edit' | 'delete'; discardReview?: boolean }) => {
      // The form is the sheet as seen; the page keeps its grids in PDF terms (``gridForm``).
      const grid: PageGridInput = {
        label: form.label.trim(),
        orientation: seenOrientation(form.orientation, rotation),
        x: point[0],
        y: point[1],
        slope: diagonal ? (groupSlope ?? (form.slope.trim() ? seenSlope(Number(form.slope), rotation) : null)) : null,
        real_angle: diagonal && form.realAngle.trim() ? Number(form.realAngle) : null,
        reference: form.reference,
        distance: form.reference ? form.distance.trim() : '',
        direction: seenDirection(form.direction, form.orientation, rotation),
        base: !diagonal && form.base,
      }
      return changePageGrid(
        page.id,
        action === 'delete' ? { action, label: editing! } : { action, label: editing ?? undefined, grid },
        { discardReview },
      )
    },
    meta: { suppressErrorToast: true },
    onSuccess: (_, { action }) => {
      const label = action === 'delete' ? editing : form.label.trim()
      onSaved(before, `Grid “${label}” ${action === 'add' ? 'added' : action === 'edit' ? 'updated' : 'deleted'}: run the page again when you have finished with its grids`)
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === 'review_in_progress') return setReviewWarning(apiError.message)
      setConfirmDelete(false)
      setErrors(toFormErrors(error))
    },
  })
  const action = editing ? 'edit' : 'add'

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.label.trim()) return setErrors({ fields: { label: ['Enter the grid label.'] }, form: null })
    if (diagonal && groupSlope === null && !form.slope.trim())
      return setErrors({ fields: { slope: ['Give the slope, pick two points, or choose a diagonal group.'] }, form: null })
    save.mutate({ action })
  }

  const pill = (value: string, label: string, current: string, onPick: () => void) => (
    <button key={value} type="button" className="pill" aria-pressed={current === value} onClick={onPick}>
      {label}
    </button>
  )

  return (
    <>
      <Dialog open={!hidden && !reviewWarning} onOpenChange={(o) => !o && onClose()} title={editing ? 'Edit Grid Line' : 'Add Grid Line'}>
        <FormAlert message={errors.form ?? errors.fields.label?.[0] ?? null} />
        <form onSubmit={submit} noValidate className="grid-form">
          <p className="muted">
            Picked point: x {point[0].toFixed(1)}, y {point[1].toFixed(1)} (PDF points)
          </p>
          <TextField label="Grid Label" value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g., A, 1, D1" maxLength={16} autoFocus />
          <div className="pill-group" role="group" aria-label="Orientation">
            <span className="pill-group__label">Orientation</span>
            {pill('vertical', 'Vertical', form.orientation, () => set({ orientation: 'vertical', reference: '' }))}
            {pill('horizontal', 'Horizontal', form.orientation, () => set({ orientation: 'horizontal', reference: '' }))}
            {pill('diagonal', 'Diagonal', form.orientation, () => set({ orientation: 'diagonal', reference: '', base: false }))}
          </div>
          {!diagonal && (
            <label className="checkbox">
              <input type="checkbox" checked={form.base} onChange={(e) => set({ base: e.target.checked })} /> Base grid
            </label>
          )}
          {diagonal && (
            <>
              <SelectField
                label="Diagonal Group (existing slope)"
                value={form.group}
                onChange={(e) => set({ group: e.target.value, reference: '' })}
                options={[
                  { value: '', label: '— New slope —' },
                  ...groups.map((g) => ({ value: String(g.slope), label: `Slope ${seenSlope(g.slope, rotation)} (${g.labels.join(', ')})` })),
                ]}
              />
              {!form.group && (
                <TextField
                  label="Slope (rise/run, e.g. 0.5 = 1:2)"
                  value={form.slope}
                  onChange={(e) => set({ slope: e.target.value })}
                  error={errors.fields.slope}
                  inputMode="decimal"
                />
              )}
              <TextField
                label="Real-World Angle (degrees, optional)"
                value={form.realAngle}
                onChange={(e) => set({ realAngle: e.target.value })}
                inputMode="decimal"
              />
            </>
          )}
          <SelectField
            label={diagonal ? 'Reference Grid (same group)' : `Reference Grid (${form.orientation === 'vertical' ? 'Vertical' : 'Horizontal'})`}
            value={form.reference}
            onChange={(e) => set({ reference: e.target.value })}
            options={[{ value: '', label: '—' }, ...references.map((g) => ({ value: g.label, label: g.label }))]}
          />
          {form.reference && (
            <>
              <TextField
                label="Distance from Ref (ft / in)"
                value={form.distance}
                onChange={(e) => set({ distance: e.target.value })}
                error={errors.fields.distance}
                placeholder={`e.g., 10' 6"`}
              />
              <div className="pill-group" role="group" aria-label="Direction (relative to Ref)">
                <span className="pill-group__label">Direction (relative to Ref)</span>
                {pill('+', diagonal ? '+ (Towards bottom left)' : '+ (Right / Above)', form.direction, () => set({ direction: '+' }))}
                {pill('-', diagonal ? '- (Towards top right)' : '- (Left / Below)', form.direction, () => set({ direction: '-' }))}
              </div>
            </>
          )}
          <div className="button-row">
            <Button type="submit" variant="primary" loading={save.isPending && save.variables?.action !== 'delete'}>
              {editing ? 'Save Grid' : 'Add Grid'}
            </Button>
            {diagonal && <Button onClick={onPickSlope}>Pick Points for Slope</Button>}
            {editing && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                Delete Grid
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirmDelete && !reviewWarning}
        title={`Delete grid “${editing}”?`}
        confirmLabel="Delete grid"
        tone="danger"
        pending={save.isPending}
        error={save.error && !reviewWarning ? toApiError(save.error).message : null}
        onConfirm={() => save.mutate({ action: 'delete' })}
        onCancel={() => setConfirmDelete(false)}
      >
        <p>Grids measured from it are measured from its own reference grid instead, with the distances added.</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={reviewWarning !== null}
        title="This page has review work"
        confirmLabel="Run again and replace review"
        tone="danger"
        pending={save.isPending}
        onConfirm={() => save.mutate({ action: confirmDelete ? 'delete' : action, discardReview: true })}
        onCancel={() => {
          setReviewWarning(null)
          save.reset()
        }}
      >
        <p>{reviewWarning}</p>
      </ConfirmDialog>
    </>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'

import { toApiError } from '../../api/errors'
import type { GridImportResult, ProjectGrid } from '../../api/types'
import {
  addProjectGrid,
  changeProjectGrid,
  deleteProjectGrid,
  fillProjectGrids,
  importProjectGrids,
  listProjectGrids,
  type GridChanges,
} from '../../api/wireframe'
import { LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { signedFeetInches } from '../abm/format'

const DIRECTIONS: Record<ProjectGrid['direction'], string> = { x: 'Along X', y: 'Along Y', angled: 'Angled' }
const SOURCES: Record<ProjectGrid['source'], string> = { found: 'Drawings', person: 'You', csv: 'Grids file' }

/** The project's grid lines (the old Wireframer's grid table): filled from the drawings, put
 *  right by a person, and drawn in the 3D view when the wireframe is generated. */
export function ProjectGridsCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const key = ['project-grids', projectId]
  const grids = useQuery({ queryKey: key, queryFn: () => listProjectGrids(projectId) })
  const [editing, setEditing] = useState<ProjectGrid | 'new' | null>(null)
  const [deleting, setDeleting] = useState<ProjectGrid | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: key })
  const fileInput = useRef<HTMLInputElement>(null)
  // A grids file read and lined up with the project, waiting to be applied.
  const [loaded, setLoaded] = useState<{ file: File; result: GridImportResult } | null>(null)
  const preview = useMutation({
    mutationFn: (file: File) => importProjectGrids(projectId, file, false),
    meta: { suppressErrorToast: true },
    onSuccess: (result, file) => setLoaded({ file, result }),
  })

  const fill = useMutation({
    mutationFn: () => fillProjectGrids(projectId),
    onSuccess: async (result) => {
      notify.success(
        `Grids from the drawings: ${result.added} added, ${result.updated} updated, ${result.removed} removed` +
          (result.kept ? `; ${result.kept} you set or locked kept` : ''),
      )
      await refresh()
    },
  })
  const toggle = useMutation({
    mutationFn: ({ grid, changes }: { grid: ProjectGrid; changes: GridChanges }) => changeProjectGrid(projectId, grid.id, changes),
    onSuccess: () => refresh(),
  })
  const remove = useMutation({
    mutationFn: (grid: ProjectGrid) => deleteProjectGrid(projectId, grid.id),
    onSuccess: async () => {
      setDeleting(null)
      await refresh()
    },
  })

  const rows = grids.data ?? []
  // Spacing to the previous grid of the same direction, as the table is ordered.
  const spacing = new Map<string, string>()
  for (const direction of ['x', 'y'] as const) {
    const line = rows.filter((g) => g.direction === direction && !g.hidden)
    line.forEach((g, i) => {
      if (i > 0) spacing.set(g.id, signedFeetInches(String(Number(g.position_mm) - Number(line[i - 1]!.position_mm))) ?? '')
    })
  }

  return (
    <section className="card" aria-labelledby="wf-grids">
      <div className="card__header">
        <h2 id="wf-grids">Grids</h2>
        {canEdit && (
          <div className="button-row button-row--tight">
            <Button loading={fill.isPending} onClick={() => fill.mutate()}>
              {rows.length ? 'Refresh from the drawings' : 'Fill from the drawings'}
            </Button>
            <Button onClick={() => setEditing('new')}>Add grid</Button>
            <Button loading={preview.isPending} onClick={() => fileInput.current?.click()}>
              Load grids file…
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="visually-hidden"
              aria-label="Grids file"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) preview.mutate(file)
              }}
            />
          </div>
        )}
      </div>
      {preview.error && (
        <p className="field__error" role="alert">
          {toApiError(preview.error).fieldErrors.file?.join(' ') ?? toApiError(preview.error).message}
        </p>
      )}
      <p className="muted">
        The project’s grid lines, measured from the reference crossing (the origin) as the plans place them, or loaded from a Tekla grids file. Put a line right
        here if the drawings read it wrong: the 3D view draws this table when the wireframe is generated again. Lines you
        change or lock are kept when the table is refreshed from the drawings.
      </p>
      {grids.isPending && <LoadingState label="Loading the grids…" />}
      {grids.data && rows.length === 0 && (
        <p className="muted">No grid table yet: the 3D view draws the grid lines the drawings show. Fill it from the drawings to check and correct them.</p>
      )}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">The project’s grid lines</caption>
            <thead>
              <tr>
                <th scope="col">Grid</th>
                <th scope="col">Direction</th>
                <th scope="col" className="num">From the origin</th>
                <th scope="col" className="num">Spacing</th>
                <th scope="col">From</th>
                <th scope="col">On the plans</th>
                <th scope="col">Locked</th>
                <th scope="col">Hidden</th>
                {canEdit && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id} data-hidden={g.hidden || undefined}>
                  <th scope="row">{g.label}</th>
                  <td>
                    {DIRECTIONS[g.direction]}
                    {g.direction === 'angled' && g.angle_deg != null && <span className="muted"> {Math.round(g.angle_deg)}°</span>}
                  </td>
                  <td className="num nowrap">{g.position_display}</td>
                  <td className="num nowrap">{spacing.get(g.id) || <span className="muted">—</span>}</td>
                  <td>{SOURCES[g.source]}</td>
                  <td>
                    {g.plans === 0 ? (
                      <span className="muted">—</span>
                    ) : g.disagrees ? (
                      <span
                        className="field__error"
                        title="Some plans place this line elsewhere (more than 6 inches away): a sheet may be read at a wrong scale, or the label names another line there. The position is the one the plans that agree give."
                      >
                        ⚠ {g.plans_agreeing} of {g.plans} agree
                      </span>
                    ) : (
                      `${g.plans} ${g.plans === 1 ? 'plan' : 'plans'}`
                    )}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Lock grid ${g.label}`}
                      checked={g.locked}
                      disabled={!canEdit}
                      onChange={(e) => toggle.mutate({ grid: g, changes: { locked: e.target.checked } })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Hide grid ${g.label}`}
                      checked={g.hidden}
                      disabled={!canEdit}
                      onChange={(e) => toggle.mutate({ grid: g, changes: { hidden: e.target.checked } })}
                    />
                  </td>
                  {canEdit && (
                    <td className="nowrap">
                      <button type="button" className="link-button" aria-label={`Edit grid ${g.label}`} title="Edit" onClick={() => setEditing(g)}>
                        ✎
                      </button>{' '}
                      <button type="button" className="link-button" aria-label={`Delete grid ${g.label}`} title="Delete" onClick={() => setDeleting(g)}>
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {loaded && (
        <GridFileDialog
          projectId={projectId}
          loaded={loaded}
          onDone={() => setLoaded(null)}
          onApplied={refresh}
        />
      )}
      {editing && (
        <GridDialog projectId={projectId} grid={editing === 'new' ? null : editing} onDone={() => setEditing(null)} onSaved={refresh} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete grid ${deleting?.label ?? ''}?`}
        confirmLabel="Delete grid"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onCancel={() => setDeleting(null)}
      >
        <p>It goes from the table. If the drawings show it, refreshing from the drawings brings it back.</p>
      </ConfirmDialog>
    </section>
  )
}

function GridDialog({
  projectId,
  grid,
  onDone,
  onSaved,
}: {
  projectId: string
  grid: ProjectGrid | null
  onDone: () => void
  onSaved: () => unknown
}) {
  const [form, setForm] = useState({
    label: grid?.label ?? '',
    direction: grid?.direction ?? ('x' as ProjectGrid['direction']),
    position: grid?.position_display ?? '',
    angle: grid?.angle_deg != null ? String(Math.round(grid.angle_deg * 100) / 100) : '',
  })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))
  const save = useMutation({
    mutationFn: () => {
      const angle = form.direction === 'angled' && form.angle.trim() ? Number(form.angle) : null
      if (!grid) return addProjectGrid(projectId, { label: form.label.trim(), direction: form.direction, position: form.position.trim(), angle_deg: angle })
      const changes: GridChanges = {}
      if (form.label.trim() !== grid.label) changes.label = form.label.trim()
      if (form.position.trim() !== grid.position_display) changes.position = form.position.trim()
      if (grid.direction === 'angled' && angle !== grid.angle_deg) changes.angle_deg = angle
      return changeProjectGrid(projectId, grid.id, changes)
    },
    meta: { suppressErrorToast: true, successMessage: grid ? 'Grid saved' : 'Grid added' },
    onSuccess: async () => {
      await onSaved()
      onDone()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()} title={grid ? `Grid ${grid.label}` : 'Add a grid'}>
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField label="Label" value={form.label} onChange={set('label')} error={errors.fields.label} maxLength={32} autoFocus />
        {!grid && (
          <SelectField
            label="Direction"
            value={form.direction}
            onChange={set('direction')}
            error={errors.fields.direction}
            options={[
              { value: 'x', label: 'Along X (drawn up the plan)' },
              { value: 'y', label: 'Along Y (drawn across the plan)' },
              { value: 'angled', label: 'Angled' },
            ]}
          />
        )}
        <TextField
          label="From the origin"
          value={form.position}
          onChange={set('position')}
          error={errors.fields.position}
          placeholder={'e.g. 30\'-0" or -12\'-6"'}
          hint="Measured from the reference crossing; negative on the other side."
        />
        {form.direction === 'angled' && (
          <TextField label="Angle (degrees)" inputMode="decimal" value={form.angle} onChange={set('angle')} error={errors.fields.angle_deg} />
        )}
        <div className="button-row">
          <Button type="submit" variant="primary" loading={save.isPending}>
            {grid ? 'Save' : 'Add grid'}
          </Button>
          <Button onClick={onDone}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

const ORIGIN: Record<GridImportResult['origin'], string> = {
  reference: 'Moved so the project’s reference crossing is at the origin, as on the drawings.',
  drawings: 'The file doesn’t have the reference crossing’s lines: moved onto the grid lines the drawings show.',
  file: 'Nothing to line it up on yet (no plan is placed): positions are as the file has them.',
}
const ACTIONS: Record<GridImportResult['grids'][number]['action'], string> = {
  add: 'Added',
  replace: 'Replaces the table’s',
  locked: 'Locked: kept as it is',
}

/** What a grids file says, line by line against the drawings, before it goes in the table. */
function GridFileDialog({
  projectId,
  loaded,
  onDone,
  onApplied,
}: {
  projectId: string
  loaded: { file: File; result: GridImportResult }
  onDone: () => void
  onApplied: () => unknown
}) {
  const { file, result } = loaded
  const apply = useMutation({
    mutationFn: () => importProjectGrids(projectId, file, true),
    meta: { successMessage: 'Grids from the file put in the table' },
    onSuccess: async () => {
      await onApplied()
      onDone()
    },
  })
  const off = result.grids.filter((g) => g.difference_mm != null && Math.abs(Number(g.difference_mm)) > 152.4).length
  return (
    <Dialog open onOpenChange={(o) => !o && onDone()} title={`Grids file: ${file.name}`} description={ORIGIN[result.origin]}>
      <p>
        {result.grids.length} grid lines read ({result.format === 'tekla' ? 'Tekla' : result.format} layout)
        {off > 0 && (
          <>
            {' '}
            · <span className="field__error">⚠ {off} more than 6" from where the drawings place them</span>
          </>
        )}
        .
      </p>
      {result.unplaced.length > 0 && (
        <p className="muted">Not used (the file doesn’t say which way they run, and no plan shows them): {result.unplaced.join(', ')}</p>
      )}
      <div className="table-wrap">
        <table className="table table--compact">
          <caption className="visually-hidden">Grid lines in the file</caption>
          <thead>
            <tr>
              <th scope="col">Grid</th>
              <th scope="col">Direction</th>
              <th scope="col" className="num">From the origin</th>
              <th scope="col" className="num">Drawings differ by</th>
              <th scope="col">In the table</th>
            </tr>
          </thead>
          <tbody>
            {result.grids.map((g) => {
              const far = g.difference_mm != null && Math.abs(Number(g.difference_mm)) > 152.4
              return (
                <tr key={`${g.direction}:${g.label}`}>
                  <th scope="row">{g.label}</th>
                  <td>{DIRECTIONS[g.direction]}</td>
                  <td className="num nowrap">{g.position_display}</td>
                  <td className={`num nowrap${far ? ' field__error' : ''}`}>
                    {g.difference_mm == null ? <span className="muted">Not on the drawings</span> : `${far ? '⚠ ' : ''}${g.difference_display}`}
                  </td>
                  <td>{ACTIONS[g.action]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {apply.error && <FormAlert message={toApiError(apply.error).message} />}
      <div className="button-row">
        <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate()}>
          Put in the table
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </Dialog>
  )
}

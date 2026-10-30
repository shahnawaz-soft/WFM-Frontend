import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { toApiError } from '../../../api/errors'
import { setScale, type SetScaleResult } from '../../../api/processing'
import type { DrawingPage, ExtractionRun, Project } from '../../../api/types'
import { LoadingState } from '../../../components/feedback/States'
import { notify } from '../../../components/feedback/toastStore'
import { Button } from '../../../components/ui/Button'
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog'
import { Dialog } from '../../../components/ui/Dialog'
import { FormAlert, TextField } from '../../../components/ui/Field'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../../lib/formErrors'
import { feetInches } from '../../abm/format'

/** Scales people pick from (they can type any other). */
const COMMON_SCALES = [
  '1/16" = 1\'-0"',
  '3/32" = 1\'-0"',
  '1/8" = 1\'-0"',
  '3/16" = 1\'-0"',
  '1/4" = 1\'-0"',
  '3/8" = 1\'-0"',
  '1/2" = 1\'-0"',
  '3/4" = 1\'-0"',
  '1" = 1\'-0"',
  '1:50',
  '1:100',
  '1:200',
]

interface ScalePanelProps {
  /** From the page detail only (Step B); null = no run, undefined = the detail is loading. */
  run: ExtractionRun | null | undefined
  /** The page's detail (its own scale, if a person set one); undefined while loading. */
  page?: DrawingPage
  project?: Project
  canEdit?: boolean
}

/** The page's scale and a way to change it; how it was read and checked is folded away. */
export function ScalePanel({ run, page, project, canEdit = false }: ScalePanelProps) {
  const [changing, setChanging] = useState(false)
  const setBy = run?.summary?.scale_set_by ?? ''
  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Scale</h2>
      </div>
      {run === undefined && <LoadingState label="Loading the scale…" />}
      {run === null && <p className="muted">Run Plan on this page to read its scale.</p>}
      {run && <ScaleValue run={run} setBy={setBy} />}
      {project?.scale && setBy !== 'project' && (
        <p className="muted">Project scale: {project.scale} (for pages whose own scale isn’t clear)</p>
      )}
      {canEdit && page && project && (
        <div className="button-row">
          <Button onClick={() => setChanging(true)}>Change</Button>
          {page.scale && <ClearPageScale project={project} page={page} />}
        </div>
      )}
      {run && <ScaleDetails run={run} />}
      {changing && page && project && <ChangeScaleDialog project={project} page={page} run={run} onClose={() => setChanging(false)} />}
    </div>
  )
}

function ScaleValue({ run, setBy }: { run: ExtractionRun; setBy: string }) {
  const check = run.scale_check ?? null
  // The engine read "not to scale" on the sheet (``review_reasons``): say so, not just "not found".
  const notToScale = !run.scale_text && run.review_reasons.some((r) => r.code === 'not_to_scale')
  return (
    <p className="scale-value">
      {run.scale_text || (notToScale ? 'Not to scale' : 'Not found')}{' '}
      {setBy === 'page' ? (
        <StatusBadge tone="info" label="Set by you" />
      ) : setBy === 'project' ? (
        <StatusBadge tone="info" label="Project scale" />
      ) : notToScale ? (
        <StatusBadge tone="info" label="Marked on the drawing" />
      ) : !run.scale_text ? (
        <StatusBadge tone="warning" label="Check" />
      ) : check?.verdict === 'confirmed' ? (
        <StatusBadge tone="success" label="Confirmed by dimensions" />
      ) : check?.verdict === 'disagrees' ? (
        <StatusBadge tone="error" label="Dimensions disagree" />
      ) : run.scale_confidence !== null && run.scale_confidence < 0.7 ? (
        <StatusBadge tone="warning" label="Confirm" />
      ) : (
        <StatusBadge tone="success" label="Single scale on sheet" />
      )}
    </p>
  )
}

function ScaleDetails({ run }: { run: ExtractionRun }) {
  // Summary keys are optional: older runs may lack some.
  const scales = run.summary?.scales_found ?? []
  const check = run.scale_check ?? null
  const spacings = run.grid_spacings ?? []
  const notToScale = !run.scale_text && run.review_reasons.some((r) => r.code === 'not_to_scale')
  return (
    <details className="project-more">
      <summary>How it was checked</summary>
      <p className="muted">Read from the scale statements printed on the sheet, and checked against its printed dimensions.</p>
      {notToScale && (
        <p>
          The drawing marks this sheet or its views “not to scale”, so lengths can’t be measured from it. Enter lengths
          by hand, set a scale, or take them from a plan that has a scale.
        </p>
      )}
      {check && !notToScale && <p>{describeCheck(check, run.scale_text)}</p>}
      {scales.length > 1 && (
        <>
          <p>This sheet states several scales; the smallest (usually the plan) was assumed:</p>
          <ul>
            {scales.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </>
      )}
      {spacings.length > 0 && (
        <table className="table table--compact">
          <caption>Grid spacing, as printed</caption>
          <thead>
            <tr>
              <th scope="col">Grids</th>
              <th scope="col">Printed</th>
              <th scope="col">On the drawing</th>
            </tr>
          </thead>
          <tbody>
            {spacings.map((s) => (
              <tr key={s.grids.join('|')}>
                <td>{s.grids.join(' – ')}</td>
                <td>{s.text}</td>
                <td>{s.agrees === true ? 'Matches' : s.agrees === false ? `Measures ${feetInches(String(s.drawn_mm))}` : 'Not checked'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  )
}

/** Saving a scale runs pages again: their results (and the project's) are refreshed. */
function useSaveScale(project: Project, page: DrawingPage, onDone: () => void) {
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  // Set when the server says people have already reviewed this page.
  const [discardWarning, setDiscardWarning] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: ({ scale, scope, discardReview }: { scale: string; scope: Scope; discardReview?: boolean }) =>
      setScale(project.id, scale, { page: scope === 'page' ? page.id : undefined, discardReview }),
    meta: { suppressErrorToast: true },
    onSuccess: async (result) => {
      setDiscardWarning(null)
      notify.success(savedMessage(result))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-page'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set'] }),
      ])
      onDone()
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === 'review_in_progress') setDiscardWarning(apiError.message)
      else setErrors(toFormErrors(error))
    },
  })
  return { save, errors, discardWarning, cancelDiscard: () => setDiscardWarning(null) }
}

function savedMessage(result: SetScaleResult): string {
  const what = result.scale ? `Scale ${result.scale} saved` : 'Scale read from the drawing again'
  const ran = `${result.queued.length} page${result.queued.length === 1 ? '' : 's'} run again`
  const left = result.skipped.length
    ? `; ${result.skipped.length} with review work left as they are (run them again from the page)`
    : ''
  return `${what}: ${ran}${left}.`
}

type Scope = 'page' | 'project'

function ChangeScaleDialog({
  project,
  page,
  run,
  onClose,
}: {
  project: Project
  page: DrawingPage
  run: ExtractionRun | null | undefined
  onClose: () => void
}) {
  const [scale, setScaleText] = useState(page.scale || run?.scale_text || project.scale || '')
  const [scope, setScope] = useState<Scope>('page')
  const { save, errors, discardWarning, cancelDiscard } = useSaveScale(project, page, onClose)
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ scale: scale.trim(), scope })
  }
  return (
    <>
      <Dialog open={discardWarning === null} onOpenChange={(o) => !o && onClose()} title="Change the scale">
        <FormAlert message={errors.form} />
        <form onSubmit={submit} noValidate>
          <TextField
            label="Scale"
            value={scale}
            onChange={(e) => setScaleText(e.target.value)}
            error={errors.fields.scale}
            maxLength={64}
            list="common-scales"
            hint={'Pick one, or type it as on a drawing: 1/4" = 1\'-0" or 1:100.'}
            autoFocus
          />
          <datalist id="common-scales">
            {COMMON_SCALES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <fieldset className="field">
            <legend className="field__label">Use it for</legend>
            <label className="checkbox">
              <input type="radio" name="scope" checked={scope === 'page'} onChange={() => setScope('page')} />
              This page
            </label>
            <label className="checkbox">
              <input type="radio" name="scope" checked={scope === 'project'} onChange={() => setScope('project')} />
              All pages in the project
            </label>
            <p className="field__hint">
              {scope === 'page'
                ? 'Replaces the scale read on this page.'
                : 'Used on every page whose scale isn’t clear (none found, several stated, or worked out from the grid). Pages with a clear printed scale keep their own.'}
            </p>
          </fieldset>
          <p className="muted">The pages it changes are run again, so their lengths and tonnage update.</p>
          <div className="button-row">
            <Button type="submit" variant="primary" loading={save.isPending} disabled={!scale.trim()}>
              Save and run again
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={discardWarning !== null}
        title="This page has review work"
        confirmLabel="Run again and replace review"
        tone="danger"
        pending={save.isPending}
        onConfirm={() => save.mutate({ scale: scale.trim(), scope, discardReview: true })}
        onCancel={() => {
          cancelDiscard()
          onClose()
        }}
      >
        <p>{discardWarning}</p>
      </ConfirmDialog>
    </>
  )
}

/** Back to the scale read from the drawing (or the project's, where the drawing's isn't clear). */
function ClearPageScale({ project, page }: { project: Project; page: DrawingPage }) {
  const { save, errors, discardWarning, cancelDiscard } = useSaveScale(project, page, () => {})
  return (
    <>
      <Button loading={save.isPending && discardWarning === null} onClick={() => save.mutate({ scale: '', scope: 'page' })}>
        Use the drawing’s scale
      </Button>
      {errors.form && <FormAlert message={errors.form} />}
      <ConfirmDialog
        open={discardWarning !== null}
        title="This page has review work"
        confirmLabel="Run again and replace review"
        tone="danger"
        pending={save.isPending}
        onConfirm={() => save.mutate({ scale: '', scope: 'page', discardReview: true })}
        onCancel={cancelDiscard}
      >
        <p>{discardWarning}</p>
      </ConfirmDialog>
    </>
  )
}

function describeCheck(check: NonNullable<ExtractionRun['scale_check']>, scaleText: string): string {
  const implied = check.implied_text ?? (check.implied_ratio ? `about 1:${Math.round(check.implied_ratio)}` : '')
  switch (check.verdict) {
    case 'confirmed':
      return `${check.agree} of ${check.checked} printed dimensions measure true at this scale.`
    case 'disagrees':
      return `The printed dimensions measure as if the plan were drawn at ${implied}. Lengths were measured at ${scaleText}; check the scale before relying on them.`
    case 'suggested':
      return `No scale is written on this page, but its printed dimensions measure as if it were drawn at ${implied}.`
    default:
      if (!scaleText) {
        return check.checked
          ? `No scale was found to check the ${check.checked} printed dimensions against.`
          : 'No scale was found, and no printed dimensions could be checked.'
      }
      return check.checked
        ? `${check.agree} of ${check.checked} printed dimensions measure true at this scale: not enough to confirm it.`
        : 'No printed dimensions could be checked on this page.'
  }
}

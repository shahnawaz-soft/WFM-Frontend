import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import type { DrawingPage, DrawingPageListItem, GridPoint } from '../../../api/types'
import { getWireframeSetup, setPageLevel } from '../../../api/wireframe'
import { LoadingState } from '../../../components/feedback/States'
import { Button } from '../../../components/ui/Button'
import { FormAlert, SelectField, TextField } from '../../../components/ui/Field'
import { StatusBadge } from '../../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../../lib/formErrors'
import { PROPOSAL_ISSUES, hasProposal, proposalState, useLevelProposals } from '../../wireframe/levelProposals'
import { sortedGridPoints } from '../grids'

const STILL_NEEDED: Record<string, string> = {
  level_missing: 'the elevation',
  reference_missing: 'the reference grid point',
}

interface LevelPanelProps {
  projectId: string
  page: DrawingPageListItem
  canEdit: boolean
  /** A point just picked on the drawing (not saved yet). */
  picked: [number, number] | null
  /** The grid intersection the picked point is on, when it snapped to one. */
  pickedLabel?: string | null
  /** Grid intersections found on the plan, to choose from instead of clicking. */
  gridPoints?: GridPoint[] | null
  /** The page detail (where grid points come from) is still loading. */
  gridPointsLoading?: boolean
  onPick: () => void
  onChoose?: (point: GridPoint) => void
  onPickedSaved: () => void
}

/** Which level this plan shows, its elevation, and the reference grid point every plan is
 *  aligned on in 3D (OD-10). */
export function LevelPanel({ projectId, page, canEdit, picked, pickedLabel, gridPoints, gridPointsLoading = false, onPick, onChoose, onPickedSaved }: LevelPanelProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    level_label: page.level_label,
    elevation: page.elevation_display,
    reference_label: page.reference_label,
  })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  // A newly picked grid intersection fills in the grid label (the person can still change it).
  const [seenLabel, setSeenLabel] = useState(pickedLabel ?? null)
  if ((pickedLabel ?? null) !== seenLabel) {
    setSeenLabel(pickedLabel ?? null)
    if (pickedLabel) setForm((f) => ({ ...f, reference_label: pickedLabel }))
  }
  const choices = sortedGridPoints(gridPoints)
  const proposals = useLevelProposals(projectId)
  const proposal = proposals.data?.pages.find((p) => p.page_id === page.id)
  // The wireframe's own view of this page (also behind its Level set-up table).
  const setup = useQuery({ queryKey: ['wireframe-setup', projectId], queryFn: () => getWireframeSetup(projectId) })
  const setupRow = setup.data?.pages.find((p) => p.id === page.id)
  const notAPlan = setupRow?.placed_in_3d === false
  const useProposal = () => {
    if (!proposal) return
    setForm((f) => ({
      level_label: proposal.level_label || f.level_label,
      elevation: proposal.elevation_mm != null ? proposal.elevation_display : f.elevation,
      reference_label: proposal.reference_label || f.reference_label,
    }))
    if (proposal.reference_point && onChoose) {
      onChoose({ label: proposal.reference_label, x: proposal.reference_point[0]!, y: proposal.reference_point[1]! })
    }
  }
  const proposed =
    proposal &&
    proposalState(
      proposal,
      form,
      { level_label: page.level_label, elevation: page.elevation_display, reference_label: page.reference_label },
      picked,
    )
  // What the wireframe still lacks for this page that the drawings could not propose.
  const stillNeeded = (setupRow?.missing ?? []).map((m) => STILL_NEEDED[m]).filter(Boolean)
  const processed = ['processed', 'reviewed', 'added'].includes(page.status)
  const point = picked ?? (page.reference_point as [number, number] | null)

  const save = useMutation({
    mutationFn: (clearPoint: boolean) =>
      setPageLevel(page.id, {
        ...form,
        ...(clearPoint ? { reference_point: null } : picked ? { reference_point: picked } : {}),
      }),
    meta: { suppressErrorToast: true, successMessage: 'Level saved' },
    onSuccess: (updated) => {
      setErrors(NO_ERRORS)
      queryClient.setQueryData(['drawing-page', page.id], (old: DrawingPage | undefined) => ({ ...old, ...updated }))
      void queryClient.invalidateQueries({ queryKey: ['drawing-set', page.drawing_set, 'pages'] })
      void queryClient.invalidateQueries({ queryKey: ['wireframe-setup', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['level-proposals', projectId] })
      setForm({ level_label: updated.level_label, elevation: updated.elevation_display, reference_label: updated.reference_label })
      onPickedSaved()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate(false)
  }

  return (
    <div className="panel">
      <div className="panel__header">
        <h2>Level</h2>
      </div>
      {notAPlan && (
        <p className="notice notice--compact" role="note">
          This is not a plan{setupRow?.sheet_kind ? ` (${setupRow.sheet_kind} sheet)` : ''}: it needs no level set-up. Its
          members are not placed in the 3D wireframe, and still count in the ABM.
        </p>
      )}
      {processed && !notAPlan && proposal && hasProposal(proposal) && (
        <div className="notice notice--compact level-proposal" role="note" aria-label="Proposed from the drawings">
          <p>
            <strong>From the drawings:</strong> {proposal.level_label || 'no level name'}
            {proposal.elevation_mm != null && <> · {proposal.elevation_display}</>}
            {proposal.reference_label && <> · reference {proposal.reference_label}</>}
          </p>
          {proposal.elevation_source && (
            <p className="muted">
              Elevation from page {proposal.elevation_source.page_number}: {proposal.elevation_source.text}
            </p>
          )}
          {proposal.issues.map((i) => (
            <p key={i} className="muted">
              {PROPOSAL_ISSUES[i] ?? i}
            </p>
          ))}
          <div aria-live="polite">
            {proposed === 'applied' && <StatusBadge tone="success" label="Already applied" />}
            {proposed === 'applied' && stillNeeded.length > 0 && (
              <p className="level-proposal__hint">
                Still needed: {stillNeeded.join(' and ')}. The drawings don’t give {stillNeeded.length > 1 ? 'them' : 'it'}:
                type {stillNeeded.length > 1 ? 'them' : 'it'} below
                {setupRow?.missing?.includes('reference_missing') ? ' (the reference point is under “Reference grid point”)' : ''}.
              </p>
            )}
            {proposed === 'filled' && <p className="level-proposal__hint">Filled in below: choose Save level to keep them.</p>}
            {proposed === 'differs' && canEdit && <Button onClick={useProposal}>Use these</Button>}
          </div>
        </div>
      )}
      {!processed ? (
        <p className="muted">Run Plan on this page first.</p>
      ) : (
        <form onSubmit={submit} noValidate className="level-form">
          <FormAlert message={errors.form} />
          <fieldset disabled={!canEdit || save.isPending} className="level-form__fields">
            <legend className="visually-hidden">Level of this plan</legend>
            <TextField label="Level" placeholder="e.g. Level 2, Roof" value={form.level_label} onChange={set('level_label')} error={errors.fields.level_label} />
            <TextField
              label="Elevation (top of steel)"
              placeholder={'e.g. 14\'-0", 0, 4267 mm'}
              value={form.elevation}
              onChange={set('elevation')}
              error={errors.fields.elevation}
              hint="Below ground: start with a minus, e.g. -10'."
            />
            <details className="project-more">
              <summary>
                Reference grid point: {page.reference_label || (page.reference_point ? 'set' : 'not set')}
              </summary>
              <p className="muted">
                Used to place this plan in the 3D wireframe. Pick the <strong>shared grid intersection</strong> (e.g. A/1) so
                the plans line up; a plan that doesn't show it can use any crossing a plan on the shared one also shows.
              </p>
              <div className="level-form__point">
                <p className="field__label">Reference grid point</p>
                <p className={point ? '' : 'muted'}>
                  {point ? (
                    <>
                      {picked ? 'Picked (not saved yet)' : 'Set'}
                      {picked && pickedLabel ? ` on grid ${pickedLabel}` : ''} at {point[0].toFixed(0)}, {point[1].toFixed(0)} pt on the
                      sheet
                    </>
                  ) : (
                    'Not set'
                  )}
                </p>
                <div className="button-row button-row--tight">
                  <Button onClick={onPick}>{point ? 'Pick again' : 'Pick on the drawing'}</Button>
                  {page.reference_point && !picked && (
                    <Button onClick={() => save.mutate(true)}>Clear point</Button>
                  )}
                </div>
                {errors.fields.reference_point && <p className="field__error">{errors.fields.reference_point.join(' ')}</p>}
                {gridPointsLoading && onChoose && <LoadingState label="Loading the grid intersections…" />}
                {!gridPointsLoading && choices.length > 0 && onChoose && (
                  <SelectField
                    label="Or choose a grid intersection"
                    value={picked && pickedLabel ? pickedLabel : ''}
                    options={[{ value: '', label: 'Choose…' }, ...choices.map((p) => ({ value: p.label, label: p.label }))]}
                    onChange={(e) => {
                      const choice = choices.find((p) => p.label === e.target.value)
                      if (choice) onChoose(choice)
                    }}
                  />
                )}
              </div>
              <TextField label="Grid label" placeholder="e.g. A/1" value={form.reference_label} onChange={set('reference_label')} error={errors.fields.reference_label} />
            </details>
          </fieldset>
          {canEdit && (
            <div className="button-row button-row--tight">
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save level
              </Button>
            </div>
          )}
          <p className="muted">
            <Link to={`/projects/${projectId}/wireframe`}>Open the wireframe</Link>
          </p>
        </form>
      )}
    </div>
  )
}

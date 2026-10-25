import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { assignMarkSection, type BeamMark } from '../../api/abm'
import { toApiError } from '../../api/errors'
import { Button } from '../../components/ui/Button'

/** Beams the drawings name by a mark only (WRC "2J4"; the schedule giving each mark's section
 *  is on a sheet not in the set). Each mark is listed once with how many beams carry it and
 *  their total length; the section typed for a mark goes to every beam with it. */
export function BeamMarks({ projectId, marks, canEdit }: { projectId: string; marks: BeamMark[]; canEdit: boolean }) {
  return (
    <div className="beam-marks">
      <p className="muted">
        These beams are named on the drawings by a mark only: their sections are in a schedule that is not in this set. Each is measured like any
        beam. Type a mark's section once: every beam with that mark takes it (on pages being reviewed or added to the project).
      </p>
      <div className="table-wrap">
        <table className="table table--compact">
          <caption className="visually-hidden">Beam marks</caption>
          <thead>
            <tr>
              <th scope="col">Mark</th>
              <th scope="col" className="num">
                Beams
              </th>
              <th scope="col">Total length</th>
              <th scope="col">Pages</th>
              <th scope="col">Section</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((m) => (
              <MarkRow key={m.mark} projectId={projectId} mark={m} canEdit={canEdit} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MarkRow({ projectId, mark, canEdit }: { projectId: string; mark: BeamMark; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const [section, setSection] = useState(mark.sections.length === 1 ? mark.sections[0]! : '')
  const assign = useMutation({
    mutationFn: () => assignMarkSection(projectId, mark.mark, section.trim()),
    meta: { suppressErrorToast: true },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['beam-marks', projectId] })
    },
  })
  const result = assign.data
  return (
    <tr>
      <th scope="row">{mark.mark}</th>
      <td className="num">{mark.beams}</td>
      <td className="nowrap">{mark.length_display || '—'}</td>
      <td>{mark.pages.map((p) => `p.${p}`).join(', ')}</td>
      <td>
        {canEdit ? (
          <form
            className="beam-marks__assign"
            onSubmit={(e) => {
              e.preventDefault()
              if (section.trim()) assign.mutate()
            }}
          >
            <input
              className="field__control field__control--compact"
              aria-label={`Section of mark ${mark.mark}`}
              placeholder="e.g. W12X26"
              value={section}
              onChange={(e) => setSection(e.target.value)}
            />
            <Button type="submit" loading={assign.isPending} disabled={!section.trim()}>
              Apply
            </Button>
          </form>
        ) : (
          mark.sections.join(', ') || <span className="muted">No label</span>
        )}
        {mark.sections.length > 1 && <div className="muted">Now: {mark.sections.join(', ')}</div>}
        {result && (
          <div className="muted" role="status">
            {result.updated} beam{result.updated === 1 ? '' : 's'} updated
            {result.locked ? `; ${result.locked} on reviewed pages (reopen their review to change them)` : ''}.
          </div>
        )}
        {assign.error && <div className="field__error">{toApiError(assign.error).message}</div>}
      </td>
    </tr>
  )
}

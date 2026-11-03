import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { getColumnMarks, setColumnMarks } from '../../api/columns'
import { toApiError } from '../../api/errors'
import { LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'

/** Column sections by mark (C2 = HSS6X6X3/8), entered once for the project: every column with
 *  the mark takes it on every sheet. For plans whose column schedule isn't in the set (the notes
 *  say "SEE SCHEDULE ON SHEET S1.9"), or to put a schedule's section right. */
export function ColumnMarksCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const key = ['column-marks', projectId]
  const marks = useQuery({ queryKey: key, queryFn: () => getColumnMarks(projectId) })
  // What a person has typed and not saved yet, by mark.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () => setColumnMarks(projectId, draft),
    meta: { suppressErrorToast: true },
    onSuccess: (result) => {
      queryClient.setQueryData(key, result)
      setDraft({})
      notify.success('Column sizes saved: generate the wireframe again to give the columns their sections.')
    },
  })

  if (marks.isPending) return <LoadingState label="Loading the column marks…" />
  const data = marks.data
  if (!data || (!data.marks.length && !data.missing_sheets.length)) return null
  const error = save.error ? toApiError(save.error) : null

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (Object.keys(draft).length) save.mutate()
  }

  return (
    <section className="card" aria-labelledby="wf-column-marks">
      <div className="card__header">
        <h2 id="wf-column-marks">Column sizes by mark</h2>
      </div>
      {data.missing_sheets.length > 0 && (
        <p role="status" className="field__error">
          The plans give their column sizes on sheet {data.missing_sheets.join(', ')}, which this project doesn’t have. Upload
          it, or enter each mark’s section below.
        </p>
      )}
      <p className="muted">
        Every column with a mark beside it takes the section entered for that mark, on every sheet; an entry wins over a
        column schedule’s. Generate the wireframe again to apply them.
      </p>
      {data.marks.length > 0 && (
        <form onSubmit={handleSubmit} noValidate>
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Column marks</caption>
              <thead>
                <tr>
                  <th scope="col">Mark</th>
                  <th scope="col" className="num">
                    Columns
                  </th>
                  <th scope="col">From a schedule</th>
                  <th scope="col">Section</th>
                </tr>
              </thead>
              <tbody>
                {data.marks.map((m) => (
                  <tr key={m.mark}>
                    <th scope="row">{m.mark}</th>
                    <td className="num">{m.on_plans}</td>
                    <td>{m.schedule_conflict ? '⚠ schedules disagree' : m.schedule || '—'}</td>
                    <td>
                      {canEdit ? (
                        <input
                          className="col-sched__input"
                          aria-label={`Section for ${m.mark}`}
                          placeholder={m.schedule || 'e.g. W14X99'}
                          value={draft[m.mark] ?? m.entered}
                          maxLength={40}
                          onChange={(e) => setDraft((d) => ({ ...d, [m.mark]: e.target.value }))}
                        />
                      ) : (
                        m.size || <span className="muted">not given</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && (
            <p className="field__error" role="alert">
              {(error.fieldErrors.sizes ?? [error.message]).join(' ')}
            </p>
          )}
          {canEdit && (
            <div className="button-row">
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!Object.keys(draft).length}>
                Save sizes
              </Button>
            </div>
          )}
        </form>
      )}
    </section>
  )
}

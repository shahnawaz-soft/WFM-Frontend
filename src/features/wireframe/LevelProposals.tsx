import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { applyLevelProposals } from '../../api/wireframe'
import { Button } from '../../components/ui/Button'
import { signedFeetInches } from '../abm/format'
import { differs, hasProposal, PROPOSAL_ISSUES, useLevelProposals } from './levelProposals'

/** The level set-up read from the drawings, page by page, for a person to apply. */
export function LevelProposalsCard({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const queryClient = useQueryClient()
  const proposals = useLevelProposals(projectId)
  const apply = useMutation({
    mutationFn: (pages: string[]) => applyLevelProposals(projectId, pages),
    meta: { successMessage: 'Levels set from the drawings' },
    onSuccess: () => {
      for (const key of [['level-proposals', projectId], ['wireframe-setup', projectId], ['column-schedule', projectId]]) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
  const rows = (proposals.data?.pages ?? []).filter(hasProposal)
  if (!rows.length) return null
  const pending = rows.filter(differs)
  return (
    <section className="card" aria-labelledby="level-proposals">
      <div className="card__header">
        <h2 id="level-proposals">Proposed from the drawings</h2>
        {canEdit && pending.length > 0 && (
          <Button variant="primary" loading={apply.isPending} onClick={() => apply.mutate(pending.map((p) => p.page_id))}>
            Apply to {pending.length} {pending.length === 1 ? 'page' : 'pages'}
          </Button>
        )}
      </div>
      <p className="muted">
        Level names from each plan's title, elevations from the level markers on the elevation and section sheets, and a grid
        crossing found on the plans{proposals.data?.reference_label ? ` (${proposals.data.reference_label})` : ''} as the reference point.
        Check them, then apply. You can still change any of them on the page's Level tab.
      </p>
      <div className="table-wrap">
        <table className="table table--compact">
          <caption className="visually-hidden">Level set-up proposed from the drawings</caption>
          <thead>
            <tr>
              <th scope="col">Page</th>
              <th scope="col">Level</th>
              <th scope="col">Elevation</th>
              <th scope="col">Reference</th>
              <th scope="col">Notes</th>
              {canEdit && (
                <th scope="col">
                  <span className="visually-hidden">Apply</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.page_id}>
                <th scope="row">
                  <Link to={`/projects/${projectId}/pages/${p.page_id}?tab=level`}>
                    Page {p.page_number} · {p.original_filename}
                  </Link>
                </th>
                <td>{p.level_label || <span className="muted">—</span>}</td>
                <td>
                  {p.elevation_mm != null ? (
                    <>
                      {p.elevation_display}
                      {p.elevation_source && <div className="muted">page {p.elevation_source.page_number}: {p.elevation_source.text}</div>}
                    </>
                  ) : p.current.elevation_mm != null ? (
                    // Nothing to propose from the drawings, but typed on this page: show what it has.
                    <>
                      {signedFeetInches(p.current.elevation_mm)}
                      <div className="muted">typed on this page's Level tab</div>
                    </>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>{p.reference_label || <span className="muted">—</span>}</td>
                <td>
                  {p.issues
                    .filter((i) => !(i === 'no_elevation_marked' && p.current.elevation_mm != null))
                    .map((i) => (
                    <div key={i} className="muted">
                      {PROPOSAL_ISSUES[i] ?? i}
                    </div>
                  ))}
                  {p.alternatives.map((a) => (
                    <div key={`${a.page_id}${a.text}`} className="muted">
                      Also {signedFeetInches(a.elevation_mm)} (page {a.page_number}: {a.text})
                    </div>
                  ))}
                </td>
                {canEdit && (
                  <td>
                    {differs(p) ? (
                      <Button onClick={() => apply.mutate([p.page_id])} disabled={apply.isPending} aria-label={`Apply to page ${p.page_number}`}>
                        Apply
                      </Button>
                    ) : (
                      <span className="muted">Set</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

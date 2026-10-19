import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { getAbmSummary, getAbmTotals } from '../../api/abm'
import type { Project } from '../../api/types'
import { formatTonnes, formatTons } from './format'

/** Where the project's ABM stands, with the way in. */
export function ProjectAbmCard({ project }: { project: Project }) {
  const summary = useQuery({ queryKey: ['abm', project.id, 'summary'], queryFn: () => getAbmSummary(project.id) })
  const totals = useQuery({ queryKey: ['abm', project.id, 'totals'], queryFn: () => getAbmTotals(project.id) })
  const s = summary.data
  const t = totals.data
  return (
    <section className="card" aria-labelledby="abm-card-heading">
      <div className="card__header">
        <h2 id="abm-card-heading">ABM</h2>
        <div className="button-row button-row--tight">
          <Link className="button button--secondary" to={`/projects/${project.id}/columns`}>
            Column schedule
          </Link>
          <Link className="button button--primary" to={`/projects/${project.id}/abm`}>
            Open ABM
          </Link>
        </div>
      </div>
      {summary.isPending && <p className="muted">Loading…</p>}
      {s && s.pages.length === 0 && (
        <p className="muted">
          No pages added yet. Review a processed page, mark it reviewed, then choose <strong>Add to project</strong>.
        </p>
      )}
      {s && s.pages.length > 0 && (
        <p>
          <strong>{s.entries.toLocaleString()}</strong> {s.entries === 1 ? 'entry' : 'entries'} (quantity{' '}
          {s.quantity.toLocaleString()}) from {s.pages.length} {s.pages.length === 1 ? 'page' : 'pages'}
          {s.open > 0 && <> · {s.open} awaiting review</>}
          {s.unsupported > 0 && <> · {s.unsupported} unsupported</>}
          {s.pages_reviewed > 0 && (
            <span className="muted">
              {' '}
              · {s.pages_reviewed} reviewed {s.pages_reviewed === 1 ? 'page' : 'pages'} not added yet
            </span>
          )}
        </p>
      )}
      {s && s.pages.length > 0 && t && (
        <p>
          Reviewed tonnage: <strong>{formatTons(t.reviewed.weight)}</strong> ({formatTonnes(t.reviewed.weight)})
          {!t.complete && <span className="muted"> · not complete: some entries are awaiting review or cannot be weighed</span>}
        </p>
      )}
    </section>
  )
}

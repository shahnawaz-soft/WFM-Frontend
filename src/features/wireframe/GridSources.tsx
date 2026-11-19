import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import type { ProjectGrid } from '../../api/types'
import { getGridSources } from '../../api/wireframe'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'

const MEASURED: Record<string, string> = {
  printed_dimensions: 'printed grid dimensions',
  drawn_at_scale: 'drawn length at the sheet scale',
}

/** Where a grid line's position comes from, plan by plan (the old Wireframer's grid derivation
 *  path): each plan's position, the crossing it is placed from, the distance from it and how it
 *  was measured. A plan that disagrees is the one to open and put right. */
export function GridSources({ projectId, grid, onClose }: { projectId: string; grid: ProjectGrid; onClose: () => void }) {
  const sources = useQuery({ queryKey: ['grid-sources', projectId, grid.id], queryFn: () => getGridSources(projectId, grid.id) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Where grid ${grid.label} comes from`}>
      <p className="muted">
        In the table: {grid.position_display} from the origin. Each plan that draws it places it from its own reference crossing; a plan more than 6"
        away is marked. Open it to check its scale, its reference point, or the grid on it (Add grids).
      </p>
      {sources.isLoading ? (
        <LoadingState label="Reading the plans…" />
      ) : sources.isError ? (
        <ErrorState title="Could not read the plans" error={sources.error} onRetry={() => void sources.refetch()} />
      ) : !sources.data?.length ? (
        <p>No placed plan draws this line: it was set by a person or loaded from a grids file.</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Plan</th>
                <th scope="col">Level</th>
                <th scope="col">Placed from</th>
                <th scope="col" className="num">Distance from it</th>
                <th scope="col">Measured by</th>
                <th scope="col" className="num">Position</th>
                <th scope="col">Agrees</th>
              </tr>
            </thead>
            <tbody>
              {sources.data.map((s) => (
                <tr key={`${s.page_id}:${s.position_mm}`}>
                  <th scope="row">
                    <Link to={`/projects/${projectId}/pages/${s.page_id}`}>
                      p.{s.page_number}
                      {s.sheet_number ? ` · ${s.sheet_number}` : ''}
                    </Link>
                  </th>
                  <td>{s.level_label || '—'}</td>
                  <td>{s.reference_label || 'its reference point'}</td>
                  <td className="num nowrap">{s.from_reference_display}</td>
                  <td>{MEASURED[s.measured_by] ?? s.measured_by}</td>
                  <td className="num nowrap">{s.position_display}</td>
                  <td>{s.agrees ? 'Yes' : <span className="field__error">⚠ No</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="button-row">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { getColumnSchedule, syncColumns } from '../../api/columns'
import { toApiError } from '../../api/errors'
import { getProject } from '../../api/projects'
import type { ColumnCell, ColumnSchedule } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { StatusTone } from '../../components/ui/StatusIcon'
import { signedFeetInches } from '../abm/format'
import { projectCan } from '../projects/useProjectPermissions'

const MISSING_LABELS: Record<string, string> = {
  reference_missing: 'reference grid point',
  scale_missing: 'drawing scale',
}

const SOURCE_LABELS: Record<string, string> = {
  label: 'From its label',
  person: 'Typed as a column',
  symbol: 'From its symbol',
  schedule: 'Section from the column schedule',
}

/** Every column in the project by grid crossing and level, with its section and height
 *  (port step 4, OD-32). Columns are in the ABM with these heights. */
export function ColumnSchedulePage() {
  const { projectId = '' } = useParams()
  const queryClient = useQueryClient()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const schedule = useQuery({ queryKey: ['column-schedule', projectId], queryFn: () => getColumnSchedule(projectId) })
  const sync = useMutation({
    mutationFn: () => syncColumns(projectId),
    meta: { successMessage: 'ABM updated' },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['column-schedule', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
    },
  })

  const error = project.error ?? schedule.error
  if (error) {
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not open the column schedule" error={error} />
    )
  }
  if (!project.data || !schedule.data) return <LoadingState label="Opening column schedule…" />

  const s = schedule.data
  const canEdit = projectCan(project.data, 'project.edit')
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/projects/${projectId}`}>{project.data.name}</Link>
      </nav>
      <div className="page-header">
        <div>
          <h1>Column schedule</h1>
          <p className="muted">
            Every column by grid crossing (rows) and storey (columns). A column's length in the ABM is its storey height, from
            the levels set on each page's Level tab.
          </p>
        </div>
        {canEdit && s.not_in_bill > 0 && (
          <Button variant="primary" loading={sync.isPending} onClick={() => sync.mutate()}>
            Add {s.not_in_bill} to the ABM
          </Button>
        )}
      </div>
      {sync.error && <p className="field__error">{toApiError(sync.error).message}</p>}

      {s.skipped_pages.length > 0 && (
        <div className="notice" role="note">
          <p>Columns on these pages can't be placed until their level set-up is finished:</p>
          <ul>
            {s.skipped_pages.map((p) => (
              <li key={p.page_id}>
                <Link to={`/projects/${projectId}/pages/${p.page_id}?tab=level`}>Page {p.page_number}</Link>: needs its{' '}
                {p.missing.map((m) => MISSING_LABELS[m] ?? m).join(' and ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.stacks.length === 0 ? (
        <p className="muted">
          No columns yet. Add pages to the project and set their level (Level panel on each page); columns come from the column
          symbols and labels found on them.
        </p>
      ) : (
        <>
          <p>
            <strong>{s.columns}</strong> {s.columns === 1 ? 'column' : 'columns'} on {s.stacks.length} column{' '}
            {s.stacks.length === 1 ? 'line' : 'lines'} over {s.storeys.length} {s.storeys.length === 1 ? 'storey' : 'storeys'}
            {s.without_size > 0 && (
              <>
                {' '}
                · <strong>{s.without_size}</strong> without a section: enter it in the{' '}
                <Link to={`/projects/${projectId}/abm?search=column`}>ABM</Link>
              </>
            )}
          </p>
          <Legend />
          <ScheduleTable projectId={projectId} schedule={s} />
        </>
      )}
    </>
  )
}

type Storey = ColumnSchedule['storeys'][number]
type Stack = ColumnSchedule['stacks'][number]

const mm = (v: string | null | undefined) => (v == null ? null : Number(v))
const sameMm = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) < 0.05

/** The storey a counted cell covers (base → base + height), or null (not placed). */
function storeyOf(cell: ColumnCell, storeys: Storey[]): Storey | null {
  const base = mm(cell.base_mm)
  const height = mm(cell.height_mm)
  if (base == null || height == null) return null
  return storeys.find((s) => sameMm(mm(s.base_mm), base) && sameMm(mm(s.top_mm), base + height)) ?? null
}

/** A stack's cells by storey: each counted cell, with the copies of it on other plans. */
function byStorey(stack: Stack, storeys: Storey[]) {
  const counted = stack.cells.filter((c) => c.same_as_page == null)
  const copies = stack.cells.filter((c) => c.same_as_page != null)
  const placed = new Map<Storey, { cell: ColumnCell; copies: number[] }[]>()
  const notPlaced: ColumnCell[] = []
  for (const cell of counted) {
    const storey = storeyOf(cell, storeys)
    if (!storey) {
      notPlaced.push(cell)
      continue
    }
    const shownAlso = copies
      .filter((c) => c.same_as_page === cell.page_number && sameMm(mm(c.base_mm), mm(cell.base_mm)))
      .map((c) => c.page_number)
    placed.set(storey, [...(placed.get(storey) ?? []), { cell, copies: shownAlso }])
  }
  return { placed, notPlaced }
}

const levelNames = (names: string[]) => names.join(' / ')

function ScheduleTable({ projectId, schedule }: { projectId: string; schedule: ColumnSchedule }) {
  const storeys = schedule.storeys
  const rows = schedule.stacks.map((stack) => ({ stack, ...byStorey(stack, storeys) }))
  const anyNotPlaced = rows.some((r) => r.notPlaced.length > 0)
  return (
    <div className="table-wrap column-schedule__wrap">
      <table className="table table--compact column-schedule">
        <caption className="visually-hidden">Columns by grid crossing (rows) and storey (columns)</caption>
        <thead>
          <tr>
            <th scope="col">Grid</th>
            {storeys.map((st) => (
              <th scope="col" key={`${st.base_mm}|${st.top_mm}`} className="column-schedule__storey">
                <span className="column-schedule__span">
                  {st.base_display} → {st.top_display}
                </span>
                <span className="column-schedule__levels">
                  {levelNames(st.base_levels) || 'base'} → {levelNames(st.top_levels) || 'top of steel'}
                </span>
              </th>
            ))}
            {anyNotPlaced && <th scope="col">Not placed</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ stack, placed, notPlaced }) => (
            <tr key={`${stack.x},${stack.y}`}>
              <th scope="row">
                {stack.grid ? (
                  <span data-near={stack.grid.startsWith('near ') || undefined} className="column-schedule__grid">
                    {stack.grid}
                  </span>
                ) : (
                  <span className="muted" title="Not at a grid crossing: its position from the reference grid point">
                    {`${signedFeetInches(stack.x)}, ${signedFeetInches(stack.y)}`}
                  </span>
                )}
              </th>
              {storeys.map((st) => (
                <td key={`${st.base_mm}|${st.top_mm}`}>
                  {(placed.get(st) ?? []).map(({ cell, copies }) => (
                    <CellView key={`${cell.page_id}${cell.member_id ?? ''}`} projectId={projectId} cell={cell} storey={st} copies={copies} />
                  ))}
                </td>
              ))}
              {anyNotPlaced && (
                <td>
                  {notPlaced.map((cell) => (
                    <CellView key={`${cell.page_id}${cell.member_id ?? ''}`} projectId={projectId} cell={cell} storey={null} copies={[]} />
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type CellStatus = { tone: StatusTone; label: string; detail: string }

/** One status per cell, the one that matters most; the rest goes in the tooltip. */
function cellStatus(cell: ColumnCell): CellStatus | null {
  if (!cell.designation) return { tone: 'warning', label: 'Size needed', detail: 'No section is written for this column: enter it in the ABM.' }
  if (cell.schedule_page != null)
    return { tone: 'info', label: `Schedule p.${cell.schedule_page}`, detail: `Counted in the ABM from the column schedule on page ${cell.schedule_page}.` }
  if (!cell.in_bill) return { tone: 'warning', label: 'Not in ABM yet', detail: 'Its page is not added to the project yet.' }
  return null
}

const QUIET_ISSUES = ['size_not_given', 'same_column', 'in_column_schedule']

function CellView({ projectId, cell, storey, copies }: { projectId: string; cell: ColumnCell; storey: Storey | null; copies: number[] }) {
  const name = cell.designation || 'Size not given'
  const status = cellStatus(cell)
  const others = cell.issue_messages.filter((_, i) => !QUIET_ISSUES.includes(cell.issues[i]!))
  const also = copies.length ? `Also shown on ${copies.map((n) => `p.${n}`).join(', ')}` : ''
  const tooltip = [SOURCE_LABELS[cell.source] ?? cell.source, `page ${cell.page_number}`, status?.detail, also, ...others]
    .filter(Boolean)
    .join(' · ')
  // The storey's height is in the column header; a cell says its own only when it differs (a sloped roof).
  const storeyHeight = storey ? Number(storey.top_mm) - Number(storey.base_mm) : null
  const ownHeight = storey && cell.height_mm != null && !sameMm(Number(cell.height_mm), storeyHeight)
  return (
    <div className="column-schedule__cell" data-missing={!cell.designation || undefined} title={tooltip}>
      <div className="column-schedule__line">
        {cell.member_id ? <Link to={`/projects/${projectId}/abm?member=${cell.member_id}`}>{name}</Link> : <span>{name}</span>}
        {ownHeight && <span className="column-schedule__height">{cell.height_display}</span>}
        {!storey && <span className="column-schedule__height" data-unknown>height unknown</span>}
      </div>
      {status && <StatusBadge tone={status.tone} label={status.label} />}
      {also && <span className="column-schedule__also">{also}</span>}
      {others.map((m) => (
        <span key={m} className="column-schedule__note">
          {m}
        </span>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <ul className="column-schedule__legend" aria-label="What the tags mean">
      <li>
        <StatusBadge tone="info" label="Schedule p.9" /> counted from the column schedule sheet
      </li>
      <li>
        <span className="column-schedule__also">Also shown on p.12</span> the same storey on another plan, counted once
      </li>
      <li>
        <StatusBadge tone="warning" label="Size needed" /> no section written: enter it in the ABM
      </li>
      <li className="muted">Hover a cell for where it comes from.</li>
    </ul>
  )
}

import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { SchedulerLevel, SchedulerRow } from '../../api/types'
import { Pager } from '../../components/ui/Pager'
import { usePage } from '../../components/ui/usePage'
import { signedFeetInches } from '../abm/format'
import type { ColumnGroup } from './columnGroups'

/** Column groups drawn at a time in the elevation view. */
const GROUPS_SHOWN = 40
const BAR_GAP = 46 // px between bars
/** The elevation range's height (px): the window's height less the page's header and bars, as
 *  the old Wireframer's schedule filled its window. */
function chartHeight(): number {
  return Math.max(320, (typeof window === 'undefined' ? 800 : window.innerHeight) - 340)
}

const ROTATION_LABEL: Record<SchedulerRow['rotation'], string> = { F: 'Front', T: 'Top', B: 'Back', BL: 'Below' }

/** The old Wireframer's "Visual" column schedule: the column groups listed on the left, each
 *  drawn as a bar from its lowest bottom to its highest top between the levels, and the picked
 *  group (or piece) in a properties panel on the right. */
export function ColumnVisual({
  groups,
  levels,
  selection,
  onPick,
  meta,
}: {
  groups: ColumnGroup[]
  levels: SchedulerLevel[]
  selection: Set<string>
  /** ``additive``: Ctrl+click adds or removes. */
  onPick: (ids: string[], additive: boolean) => void
  /** The meta-groups, at the top of the sidebar. */
  meta?: ReactNode
}) {
  const [sidebar, setSidebar] = useState(true)
  const [CHART_HEIGHT, setChartHeight] = useState(chartHeight)
  useEffect(() => {
    const onResize = () => setChartHeight(chartHeight())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const [pieceId, setPieceId] = useState<string | null>(null)
  const placed = useMemo(() => groups.filter((g) => g.bottom_mm !== null && g.top_mm !== null), [groups])
  const focus = useMemo(() => {
    const i = placed.findIndex((g) => g.rows.some((r) => selection.has(r.id)))
    return i >= 0 ? i : null
  }, [placed, selection])
  const view = usePage(placed.length, focus, GROUPS_SHOWN)
  const shown = placed.slice(view.start, view.end)

  const [low, high] = useMemo(() => {
    const values = [
      ...placed.flatMap((g) => [Number(g.bottom_mm), Number(g.top_mm)]),
      ...levels.map((l) => Number(l.elevation_mm)),
    ]
    return values.length ? [Math.min(...values), Math.max(...values)] : [0, 1]
  }, [placed, levels])
  // Levels at one height share one line, their names together ("CATWALK / COOLER TOS 20'-0"").
  const levelLines = useMemo(() => {
    const byHeight = new Map<number, { names: string[]; display: string }>()
    for (const l of levels) {
      const mm = Number(l.elevation_mm)
      const line = byHeight.get(mm) ?? { names: [], display: l.elevation_display }
      line.names.push(l.label)
      byHeight.set(mm, line)
    }
    return [...byHeight].map(([mm, l]) => ({ mm, text: `${l.names.join(' / ')} ${l.display}` }))
  }, [levels])
  const range = high - low || 1
  const yOf = (mm: number) => 20 + CHART_HEIGHT - ((mm - low) / range) * CHART_HEIGHT
  const width = Math.max(shown.length * BAR_GAP + 140, 400)

  const picked = groups.find((g) => g.rows.some((r) => selection.has(r.id))) ?? null
  const piece = picked?.rows.find((r) => r.id === pieceId) ?? null
  const pick = (group: ColumnGroup, additive: boolean, onePiece?: SchedulerRow) => {
    setPieceId(onePiece?.id ?? null)
    onPick(onePiece ? [onePiece.id] : group.rows.map((r) => r.id), additive)
  }

  return (
    <div className="col-visual">
      <div className="col-visual__bar">
        <button type="button" className="button button--secondary" aria-pressed={sidebar} onClick={() => setSidebar((s) => !s)}>
          Groups
        </button>
        <Pager label="Column group pages" count={placed.length} view={view} />
        {placed.length < groups.length && (
          <span className="muted">{(groups.length - placed.length).toLocaleString()} not placed yet (no level or reference point): not drawn</span>
        )}
      </div>
      <div className="col-visual__body" data-sidebar={sidebar ? 'open' : 'closed'}>
        {sidebar && (
          <div className="col-visual__side">
          {meta}
          <nav className="col-visual__groups" aria-label="Column groups">
            <ol>
              {shown.map((g, i) => (
                <li key={g.key}>
                  <button
                    type="button"
                    aria-pressed={g.rows.every((r) => selection.has(r.id))}
                    onClick={(e) => pick(g, e.ctrlKey || e.metaKey)}
                  >
                    <strong>Column Group {view.start + i + 1}</strong>
                    <span>{g.grid || 'No grid'}</span>
                    <span className="muted">
                      {signedFeetInches(g.bottom_mm)} – {signedFeetInches(g.top_mm)} · {g.rows.length} member{g.rows.length === 1 ? '' : 's'}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          </div>
        )}
        <div className="col-visual__chart">
          <svg width={width} height={CHART_HEIGHT + 60} role="img" aria-label="Column groups by elevation">
            {levelLines.map((l) => {
              const y = yOf(l.mm)
              return (
                <g key={l.mm} className="col-visual__level">
                  <line x1={0} x2={width} y1={y} y2={y} />
                  <text x={4} y={y - 4}>
                    {l.text}
                  </text>
                </g>
              )
            })}
            {shown.map((g, i) => {
              const x = 130 + i * BAR_GAP
              const on = g.rows.every((r) => selection.has(r.id))
              return (
                <g key={g.key} className="col-visual__group" data-selected={on || undefined}>
                  {g.rows
                    .filter((r) => r.bottom_mm !== null && r.top_mm !== null)
                    .map((r) => {
                      const top = yOf(Number(r.top_mm))
                      const bottom = yOf(Number(r.bottom_mm))
                      return (
                        <rect
                          key={r.id}
                          className="col-visual__piece"
                          data-selected={selection.has(r.id) || undefined}
                          x={x - 7}
                          y={top}
                          width={14}
                          height={Math.max(bottom - top, 2)}
                          rx={2}
                          onClick={(e) => pick(g, e.ctrlKey || e.metaKey, g.rows.length > 1 && e.altKey ? r : undefined)}
                        >
                          <title>
                            {`${g.grid || r.id.slice(0, 8)}: ${r.designation || 'no size'}, ${r.bottom_display} – ${r.top_display}${r.page_number ? ` (p.${r.page_number})` : ''}`}
                          </title>
                        </rect>
                      )
                    })}
                  <text className="col-visual__label" x={x} y={CHART_HEIGHT + 40} textAnchor="middle">
                    {view.start + i + 1}
                  </text>
                </g>
              )
            })}
          </svg>
          <p className="muted col-visual__hint">Click a bar to pick its column group (Ctrl+click adds it; Alt+click picks one piece of a stack).</p>
        </div>
        <aside className="col-visual__props" aria-label="Properties">
          {!picked ? (
            <p className="muted">Pick a column group to see its properties.</p>
          ) : piece ? (
            <dl className="facts">
              <dt>Column ID</dt>
              <dd className="col-sched__id">{piece.id.slice(0, 8)}</dd>
              <dt>Grid</dt>
              <dd>{piece.grid || '—'}</dd>
              <dt>Profile</dt>
              <dd>{piece.designation || '—'}</dd>
              <dt>Bottom | Top</dt>
              <dd>
                {piece.bottom_display || '—'} | {piece.top_display || '—'}
              </dd>
              <dt>Rotation</dt>
              <dd>{ROTATION_LABEL[piece.rotation]}</dd>
              <dt>Page</dt>
              <dd>{piece.page_number ? `p.${piece.page_number}` : 'Added'}</dd>
            </dl>
          ) : (
            <dl className="facts">
              <dt>Column ID</dt>
              <dd className="col-sched__id">{picked.rows[0]!.id.slice(0, 8)}</dd>
              <dt>Grid</dt>
              <dd>{picked.grid || '—'}</dd>
              <dt>Members</dt>
              <dd>{picked.rows.length}</dd>
              <dt>Height</dt>
              <dd>{signedFeetInches(picked.height_mm) ?? '—'}</dd>
              <dt>Bottom | Top</dt>
              <dd>
                {signedFeetInches(picked.bottom_mm) ?? '—'} | {signedFeetInches(picked.top_mm) ?? '—'}
              </dd>
              <dt>Profile</dt>
              <dd>{picked.designation ?? 'Mixed'}</dd>
              <dt>Rotation</dt>
              <dd>{picked.rotation ? ROTATION_LABEL[picked.rotation] : 'Mixed'}</dd>
              <dt>Pages</dt>
              <dd>{picked.pages.map((p) => `p.${p}`).join(', ') || 'Added'}</dd>
            </dl>
          )}
        </aside>
      </div>
    </div>
  )
}

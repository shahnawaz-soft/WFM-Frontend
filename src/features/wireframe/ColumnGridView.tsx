import { useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'

import type { ColumnMetaGroup, SchedulerRow, WireframeGrid } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { gridSegments, type PlanBox } from './gridGeometry'
import { placeGridLabels } from './gridLabels'
import { memberKey, META_COLOURS } from './metaGroups'

interface ViewBox {
  x: number
  y: number
  w: number
  h: number
}

/** The old Wireframer's "Grid" column schedule: the grid lines in plan with a dot at every
 *  column, coloured by its meta-group. Click a dot to pick it (Ctrl+click adds), Shift+drag a
 *  box to pick every column in it; drag to move, the wheel or +/− to zoom. */
export function ColumnGridView({
  rows,
  grids,
  metaGroups,
  selection,
  onPick,
  onClear,
  onGroup,
  grouping = false,
}: {
  rows: SchedulerRow[]
  grids: WireframeGrid[]
  metaGroups: ColumnMetaGroup[]
  selection: Set<string>
  onPick: (ids: string[], additive: boolean) => void
  onClear?: () => void
  /** Names the picked columns as a meta-group (the old Wireframer's "Group Selected"); none
   *  when the person may not. */
  onGroup?: (name: string) => void
  grouping?: boolean
}) {
  // Select: a plain drag picks a box of columns (Move: it moves the plan; Shift+drag picks).
  const [mode, setMode] = useState<'move' | 'select'>('move')
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const createGroup = () => {
    if (!name.trim() || !onGroup) return
    onGroup(name.trim())
    setName('')
    setNaming(false)
  }
  const placed = useMemo(() => rows.filter((r) => r.x_mm !== null && r.y_mm !== null), [rows])
  const box = useMemo<PlanBox>(() => {
    const xs = placed.map((r) => Number(r.x_mm))
    const ys = placed.map((r) => Number(r.y_mm))
    for (const g of grids) {
      if (g.direction === 'x') xs.push(Number(g.position_mm))
      if (g.direction === 'y') ys.push(Number(g.position_mm))
    }
    if (!xs.length || !ys.length) return { minX: 0, minY: 0, maxX: 10_000, maxY: 10_000 }
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
  }, [placed, grids])
  const segments = useMemo(() => gridSegments(grids, box), [grids, box])
  const home = useMemo<ViewBox>(() => {
    const w = Math.max(box.maxX - box.minX, 1000)
    const h = Math.max(box.maxY - box.minY, 1000)
    const m = Math.max(w, h) * 0.16 // room for the grid names round the plan
    return { x: box.minX - m, y: -box.maxY - m, w: w + 2 * m, h: h + 2 * m }
  }, [box])
  const [vb, setVb] = useState<ViewBox | null>(null)
  const view = vb ?? home
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ x: number; y: number; vb: ViewBox; boxing: boolean } | null>(null)
  const [band, setBand] = useState<ViewBox | null>(null)

  const colourOf = useMemo(() => {
    const colours = new Map<string, string>()
    metaGroups.forEach((g, i) => g.members.forEach((m) => colours.set(m, META_COLOURS[i % META_COLOURS.length]!)))
    return colours
  }, [metaGroups])

  /** A screen point → plan (svg) units. */
  const toWorld = (clientX: number, clientY: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return { x: view.x + ((clientX - rect.left) / (rect.width || 1)) * view.w, y: view.y + ((clientY - rect.top) / (rect.height || 1)) * view.h }
  }
  const zoom = (factor: number, at?: { x: number; y: number }) => {
    const c = at ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 }
    setVb({ x: c.x - (c.x - view.x) * factor, y: c.y - (c.y - view.y) * factor, w: view.w * factor, h: view.h * factor })
  }
  const onWheel = (e: WheelEvent) => zoom(e.deltaY < 0 ? 1 / 1.2 : 1.2, toWorld(e.clientX, e.clientY))
  const onDown = (e: PointerEvent) => {
    if ((e.target as Element).closest('.col-grid__dot')) return
    const p = toWorld(e.clientX, e.clientY)
    drag.current = { ...p, vb: view, boxing: e.shiftKey || mode === 'select' }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toWorld(e.clientX, e.clientY)
    if (d.boxing) setBand({ x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y) })
    else setVb({ ...d.vb, x: d.vb.x - (p.x - d.x), y: d.vb.y - (p.y - d.y) })
  }
  const onUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.boxing || !band) return setBand(null)
    const inside = placed.filter((r) => {
      const x = Number(r.x_mm)
      const y = -Number(r.y_mm)
      return x >= band.x && x <= band.x + band.w && y >= band.y && y <= band.y + band.h
    })
    setBand(null)
    onPick(
      inside.map((r) => r.id),
      e.ctrlKey || e.metaKey,
    )
  }
  const dot = Math.max(view.w, view.h) / 250
  // Names sized to the view, staggered where neighbours would touch (``placeGridLabels``).
  const labelSize = dot * 3
  const [allNames, setAllNames] = useState(false)
  const labels = useMemo(() => placeGridLabels(segments, labelSize, allNames ? 2 : 1), [segments, labelSize, allNames])

  return (
    <div className="col-grid">
      <div className="col-grid__bar" role="toolbar" aria-label="Grid tools">
        <div className="family-tabs" role="group" aria-label="Drag to">
          <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')} title="Drag moves the plan (Shift+drag picks a box)">
            Move
          </button>
          <button type="button" aria-pressed={mode === 'select'} onClick={() => setMode('select')} title="Drag a box round the columns to pick them">
            Select
          </button>
        </div>
        {selection.size > 0 && (
          <span className="col-grid__picked">
            <strong>{selection.size} selected</strong>
            {onGroup && selection.size > 1 && !naming && (
              <Button variant="primary" onClick={() => setNaming(true)}>
                ➕ Group Selected ({selection.size})
              </Button>
            )}
            {naming && (
              <span className="col-meta__new">
                <input
                  aria-label="Meta-group name"
                  placeholder="Meta-group name…"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') createGroup()
                    if (e.key === 'Escape') setNaming(false)
                  }}
                />
                <Button variant="primary" loading={grouping} disabled={!name.trim()} onClick={createGroup}>
                  Create
                </Button>
                <Button onClick={() => setNaming(false)}>Cancel</Button>
              </span>
            )}
            {onClear && <Button onClick={onClear}>Clear</Button>}
          </span>
        )}
        <Button aria-label="Zoom in" onClick={() => zoom(1 / 1.3)}>
          +
        </Button>
        <Button aria-label="Zoom out" onClick={() => zoom(1.3)}>
          −
        </Button>
        <Button onClick={() => setVb(null)}>Fit</Button>
        <label className="checkbox" title="Every grid line's name, in two rows where lines are close; otherwise point at a line to see its name">
          <input type="checkbox" checked={allNames} onChange={(e) => setAllNames(e.target.checked)} /> All grid names
        </label>
        <span className="muted">
          {placed.length.toLocaleString()} columns placed
          {placed.length < rows.length ? ` · ${(rows.length - placed.length).toLocaleString()} not placed yet (no level or reference point)` : ''} ·{' '}
          {mode === 'select'
            ? 'Drag a box round the columns to pick them (Ctrl+drag adds to the pick).'
            : 'Click a dot to pick it, Ctrl+click to add, Shift+drag a box to pick every column in it.'}
        </span>
      </div>
      <svg
        ref={svgRef}
        className="col-grid__plan"
        data-mode={mode}
        role="img"
        aria-label="Columns on the grid"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      >
        {segments.map((s, i) => (
          <g key={`${s.label}-${i}`} className="col-grid__line">
            <title>{`Grid ${s.label}`}</title>
            <line className="col-grid__hit" x1={s.from[0]} y1={-s.from[1]} x2={s.to[0]} y2={-s.to[1]} vectorEffect="non-scaling-stroke" />
            <line x1={s.from[0]} y1={-s.from[1]} x2={s.to[0]} y2={-s.to[1]} vectorEffect="non-scaling-stroke" />
            <text className="col-grid__hover-name" x={s.from[0]} y={-s.from[1]} fontSize={labelSize} textAnchor="middle">
              {s.label}
            </text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={`${l.text}-${i}`} className="col-grid__name" x={l.x} y={l.y} fontSize={labelSize} textAnchor={l.anchor}>
            {l.text}
          </text>
        ))}
        {placed.map((r) => {
          const on = selection.has(r.id)
          return (
            <circle
              key={r.id}
              className="col-grid__dot"
              data-selected={on || undefined}
              cx={Number(r.x_mm)}
              cy={-Number(r.y_mm)}
              r={on ? dot * 1.5 : dot}
              fill={on ? undefined : (colourOf.get(memberKey(r)) ?? undefined)}
              onClick={(e) => onPick([r.id], e.ctrlKey || e.metaKey)}
            >
              <title>{`${r.grid || r.id.slice(0, 8)}: ${r.designation || 'no size'}, ${r.bottom_display || '—'} – ${r.top_display || '—'}`}</title>
            </circle>
          )
        })}
        {band && <rect className="col-grid__band" x={band.x} y={band.y} width={band.w} height={band.h} vectorEffect="non-scaling-stroke" />}
      </svg>
    </div>
  )
}

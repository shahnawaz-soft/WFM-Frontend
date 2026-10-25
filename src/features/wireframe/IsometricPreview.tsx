import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import type { WireframeElement } from '../../api/types'
import { elementPoints } from './elementPoints'
import { COLORS, frameOf, HEIGHT, nearestElement, PRESETS, projector, type Cam, type Placed, type Vec, type Viewport } from './isoProjection'
import type { CameraView, ColumnLabel } from './Wireframe3D'

/** The wireframe drawn without WebGL (a browser with graphics acceleration off), on a 2D
 *  canvas: thousands of members stay smooth to turn and move. Drag to rotate or move (the
 *  Drag switch; right-drag always moves), wheel to zoom towards the cursor, click to pick
 *  (Ctrl+click for several), hover for a member's details. */
export function IsometricPreview({
  elements,
  selectedId,
  marked,
  labels,
  allHeights = false,
  view = '3d',
  viewNonce = 0,
  dragMode = 'turn',
  onSelect,
}: {
  elements: WireframeElement[]
  selectedId: string | null
  marked?: Set<string>
  labels?: Map<string, ColumnLabel>
  allHeights?: boolean
  view?: CameraView
  viewNonce?: number
  /** What a left-drag does (the switch above the view); a right-drag does the other. */
  dragMode?: 'turn' | 'move'
  onSelect?: (id: string | null, additive?: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  // The camera lives in refs while dragging: a drag redraws the canvas, not the React tree.
  const cam = useRef<Cam>(PRESETS[view])
  const vp = useRef<Viewport>({ zoom: 1, pan: [0, 0] })
  const size = useRef({ width: 960, height: HEIGHT })
  const drag = useRef<{ x: number; y: number; moved: number; mode: 'turn' | 'move' } | null>(null)
  const hoverId = useRef<string | null>(null)
  const frameRequest = useRef(0)
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null)

  const placed = useMemo<Placed[]>(
    () =>
      elements.flatMap((e) => {
        const points = elementPoints(e)
        return points ? [{ e, points: points as Vec[] }] : []
      }),
    [elements],
  )
  const frame = useMemo(() => frameOf(placed), [placed])
  const byId = useMemo(() => new Map(placed.map((p) => [p.e.id, p])), [placed])

  const draw = useCallback(() => {
    const el = canvas.current
    const ctx = el?.getContext?.('2d')
    if (!el || !ctx || !frame) return
    const { width, height } = size.current
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    const project = projector(cam.current, frame, vp.current, width, height)
    const stroke = (points: Vec[], color: string, lineWidth: number) => {
      ctx.strokeStyle = color
      ctx.lineWidth = lineWidth
      ctx.beginPath()
      points.forEach((p, i) => {
        const [x, y] = project(p)
        if (i) ctx.lineTo(x, y)
        else ctx.moveTo(x, y)
      })
      ctx.stroke()
    }
    // Beams first, then columns over them; picked and hovered last, on top.
    for (const type of ['beam', 'column'] as const) {
      for (const { e, points } of placed) {
        if (e.element_type !== type) continue
        stroke(points, e.provenance === 'added' ? COLORS.added : COLORS[type], type === 'column' ? 2 : 1.2)
      }
    }
    const picked = placed.filter((p) => p.e.id === selectedId || marked?.has(p.e.id))
    for (const p of picked) stroke(p.points, COLORS.selected, 3.5)
    const hovered = hoverId.current ? byId.get(hoverId.current) : undefined
    if (hovered && !picked.includes(hovered)) stroke(hovered.points, COLORS.hover, 3)
    // Column heights: dimension line, ticks, the height, and the bottom (green) and top (red).
    ctx.font = '600 12px system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    // Labels are not written over one another: with many columns, zoom in to read the rest.
    const written: [number, number, number, number][] = []
    for (const { e, points } of placed) {
      if (e.element_type !== 'column') continue
      if (!(allHeights || e.id === selectedId || marked?.has(e.id) || e.id === hoverId.current)) continue
      const last = points.length - 1
      const lowFirst = points[0]![2] <= points[last]![2]
      const bottom = project(points[lowFirst ? 0 : last]!)
      const top = project(points[lowFirst ? last : 0]!)
      const dx = 12
      ctx.strokeStyle = COLORS.dim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(bottom[0], bottom[1])
      ctx.lineTo(bottom[0] + dx + 4, bottom[1])
      ctx.moveTo(top[0], top[1])
      ctx.lineTo(top[0] + dx + 4, top[1])
      ctx.moveTo(bottom[0] + dx, bottom[1])
      ctx.lineTo(top[0] + dx, top[1])
      ctx.stroke()
      for (const [point, color] of [
        [bottom, COLORS.bottom],
        [top, COLORS.top],
      ] as const) {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(point[0], point[1], 3.5, 0, 2 * Math.PI)
        ctx.fill()
      }
      const text = labels?.get(e.id)?.height_display
      if (text) {
        const [tx, ty] = [(bottom[0] + top[0]) / 2 + dx + 6, (bottom[1] + top[1]) / 2]
        const w = ctx.measureText(text).width
        const rect: [number, number, number, number] = [tx - 2, ty - 8, tx + w + 2, ty + 8]
        const picked = e.id === selectedId || marked?.has(e.id) || e.id === hoverId.current
        if (!picked && written.some((r) => rect[0] < r[2] && r[0] < rect[2] && rect[1] < r[3] && r[1] < rect[3])) continue
        written.push(rect)
        ctx.lineWidth = 3
        ctx.strokeStyle = '#fff'
        ctx.strokeText(text, tx, ty)
        ctx.fillStyle = COLORS.dim
        ctx.fillText(text, tx, ty)
      }
    }
  }, [placed, frame, byId, selectedId, marked, labels, allHeights])

  const redraw = useCallback(() => {
    cancelAnimationFrame(frameRequest.current)
    frameRequest.current = requestAnimationFrame(draw)
  }, [draw])
  useEffect(() => {
    redraw()
    return () => cancelAnimationFrame(frameRequest.current)
  }, [redraw])

  // A view button: look from there, the whole model in view.
  useEffect(() => {
    cam.current = PRESETS[view]
    vp.current = { zoom: 1, pan: [0, 0] }
    redraw()
    // Only when a view button is pressed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, viewNonce])

  // The canvas's bitmap follows its size on screen (sharp on high-density screens), also when
  // the view goes full screen.
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const fit = () => {
      const width = el.clientWidth || 960
      const height = el.clientHeight || HEIGHT
      const dpr = window.devicePixelRatio || 1
      size.current = { width, height }
      el.width = Math.round(width * dpr)
      el.height = Math.round(height * dpr)
      redraw()
    }
    fit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [redraw, frame])

  // Wheel: zoom towards the cursor (a native listener: React's wheel events can't be cancelled).
  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = event.clientX - rect.left - size.current.width / 2
      const my = event.clientY - rect.top - size.current.height / 2
      const { zoom, pan } = vp.current
      const next = Math.min(Math.max(zoom * Math.exp(-event.deltaY * 0.0015), 0.2), 60)
      const k = next / zoom
      // The model point under the cursor stays under it.
      vp.current = { zoom: next, pan: [mx - (mx - pan[0]) * k, my - (my - pan[1]) * k] }
      redraw()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [redraw])

  if (!placed.length || !frame) return <p className="muted wf3d__empty">Nothing could be placed yet: complete the level set-up of the pages.</p>

  const local = (event: ReactPointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect()
    return [event.clientX - rect.left, event.clientY - rect.top] as const
  }
  const elementAt = (x: number, y: number) =>
    nearestElement(placed, projector(cam.current, frame, vp.current, size.current.width, size.current.height), x, y)

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const other = event.button === 2 || event.button === 1 || event.shiftKey  // the other way
    const moving = (dragMode === 'move') !== other
    drag.current = { x: event.clientX, y: event.clientY, moved: 0, mode: moving ? 'move' : 'turn' }
    canvas.current?.setPointerCapture?.(event.pointerId)
    setTip(null)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) {
      // Hover: the member under the cursor, highlighted, with its details.
      const [x, y] = local(event)
      const id = elementAt(x, y)
      if (id !== hoverId.current) {
        hoverId.current = id
        redraw()
      }
      setTip(id ? { id, x, y } : null)
      return
    }
    const [dx, dy] = [event.clientX - d.x, event.clientY - d.y]
    d.x = event.clientX
    d.y = event.clientY
    d.moved += Math.abs(dx) + Math.abs(dy)
    if (d.mode === 'turn') {
      const c = cam.current
      cam.current = { az: (c.az + dx * 0.4) % 360, el: Math.min(Math.max(c.el + dy * 0.4, -10), 90) }
    } else {
      const { zoom, pan } = vp.current
      vp.current = { zoom, pan: [pan[0] + dx, pan[1] + dy] }
    }
    redraw()
  }
  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (d && d.moved < 4 && onSelect) {
      const [x, y] = local(event)
      onSelect(elementAt(x, y), event.ctrlKey || event.metaKey) // a click, not a drag
    }
  }

  const beams = placed.filter((p) => p.e.element_type === 'beam').length
  const tipElement = tip ? byId.get(tip.id)?.e : undefined
  const tipLabel = tip ? labels?.get(tip.id) : undefined
  return (
    <div className="iso-view">
      <canvas
        ref={canvas}
        className="iso-preview"
        role="img"
        aria-label={`Wireframe view: ${beams} beams and ${placed.length - beams} columns placed`}
        data-mode={dragMode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          if (!drag.current && hoverId.current) {
            hoverId.current = null
            setTip(null)
            redraw()
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {tip && tipElement && (
        <div className="wf3d__tooltip" role="tooltip" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <strong>
            {tipLabel
              ? `${tipLabel.mark ? `${tipLabel.mark} · ` : ''}${tipLabel.designation || 'Size not given'}`
              : `${tipElement.element_type === 'column' ? 'Column' : 'Beam'} ${tipElement.designation || ''}`}
          </strong>
          <span>
            {tipLabel
              ? `${tipLabel.height_display}${tipLabel.bottom_level || tipLabel.top_level ? ` · ${tipLabel.bottom_level || '?'} → ${tipLabel.top_level || '?'}` : ''}`
              : tipElement.length_display}
          </span>
          <span className="muted">Click to edit · Ctrl+click to add to the selection</span>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useRef, useState, type PointerEvent, type ReactNode, type WheelEvent } from 'react'

import type { ColumnSymbol, ExtractedMember, GridLine } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { describeColumn } from './columnSymbols'
import { toViewportRect } from './geometry'
import { MemberOverlay } from './MemberOverlay'
import type { loadPdf, PageViewport } from './pdf'
import { PdfPageCanvas } from './PdfPageCanvas'

const ZOOM_STEPS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4]
const MIN_ZOOM = ZOOM_STEPS[0]!
const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!
/** Zoom used when jumping to a member if the drawing is shown smaller than this. */
const FOCUS_ZOOM = 1.5
const DRAG_THRESHOLD = 4 // px of movement before a press counts as panning, not clicking

type Fit = 'width' | 'page' | null

export interface FocusRequest {
  memberId: string
  nonce: number // a new request for the same member still re-centres
}

interface DrawingStageProps {
  widthPt: number
  heightPt: number
  rotation: number
  pageNumber: number
  label: string
  pdfState: { data?: Awaited<ReturnType<typeof loadPdf>>; error: Error | null; isPending: boolean; refetch: () => unknown }
  download: { loaded: number; total?: number } | null
  members: ExtractedMember[]
  showLabels: boolean
  selectedId: string | null
  hoveredId: string | null
  focus: FocusRequest | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  toolbar?: ReactNode
  /** When true, the next click on the drawing reports its PDF-space point instead of selecting. */
  placing?: boolean
  onPlace?: (point: [number, number]) => void
  /** While placing: a drag draws a box instead of panning, reported in PDF points
   *  ([left, bottom, right, top]); a plain click still reports a point (``onPlace``). */
  boxing?: boolean
  onBox?: (box: [number, number, number, number]) => void
  onCancelPlace?: () => void
  /** The part of the sheet counted ([left, bottom, right, top], PDF points): outside is dimmed. */
  area?: [number, number, number, number] | null
  /** A labelled point to mark on the drawing (PDF points), e.g. the reference grid point. */
  marker?: { point: [number, number]; label: string } | null
  /** Text shown while placing (default: placing a member). */
  placingHint?: string
  /** Column symbols found on the plan (drawn with the outlines). */
  columns?: ColumnSymbol[] | null
  /** Structural grid lines found on the plan, drawn when ``showGrids`` is on. */
  grids?: GridLine[] | null
  showGrids?: boolean
}

function downloadLabel(download: { loaded: number; total?: number } | null): string {
  if (!download) return 'Loading drawing…'
  const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (!download.total) return `Loading drawing… ${mb(download.loaded)}`
  const percent = Math.min(100, Math.round((download.loaded / download.total) * 100))
  return percent >= 100 ? 'Preparing drawing…' : `Loading drawing… ${percent}% of ${mb(download.total)}`
}

export function DrawingStage(props: DrawingStageProps) {
  const { widthPt, heightPt, rotation, pageNumber, label, pdfState, download, members, showLabels, focus } = props
  const scrollRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(0.25)
  const [fit, setFit] = useState<Fit>('width')
  // Tied to its page so the previous page's geometry is never used for the next page.
  const [pageViewport, setPageViewport] = useState<{ page: number; viewport: PageViewport } | null>(null)
  const viewport = pageViewport?.page === pageNumber ? pageViewport.viewport : null
  const onViewport = useCallback((vp: PageViewport) => setPageViewport({ page: pageNumber, viewport: vp }), [pageNumber])
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  // A box being drawn (layer pixels from its corner where the press started), and whether the
  // last press drew one (then its click is not a placement).
  const boxStart = useRef<{ x: number; y: number } | null>(null)
  const boxed = useRef(false)
  const [band, setBand] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const handledFocus = useRef<number | null>(null)

  const [displayW, displayH] = rotation === 90 || rotation === 270 ? [heightPt, widthPt] : [widthPt, heightPt]

  const fitZoom = useCallback(
    (mode: Exclude<Fit, null>) => {
      const box = scrollRef.current
      if (!box || !displayW || !displayH) return 1
      const availW = box.clientWidth - 32
      const availH = box.clientHeight - 32
      const z = mode === 'width' ? availW / displayW : Math.min(availW / displayW, availH / displayH)
      return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    },
    [displayW, displayH],
  )

  useEffect(() => {
    if (!fit) return
    // Ignore changes under 1%: a fit that adds or removes a scrollbar must not refit forever
    // (the drawing kept re-rendering, "blurring", on tall sheets: 18 Oct 2026).
    const apply = () => {
      const next = fitZoom(fit)
      setZoom((z) => (Math.abs(next - z) / z < 0.01 ? z : next))
    }
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    if (observer && scrollRef.current) observer.observe(scrollRef.current)
    return () => observer?.disconnect()
  }, [fit, fitZoom])

  // Jump to a member, step 1 (during render, on a new request): zoom in if the drawing is
  // shown small. Step 2 (effect below) centres the label once the page has re-rendered.
  const [seenFocus, setSeenFocus] = useState<number | null>(null)
  if (focus && focus.nonce !== seenFocus) {
    setSeenFocus(focus.nonce)
    if (zoom < FOCUS_ZOOM) {
      setFit(null)
      setZoom(FOCUS_ZOOM)
    }
  }

  useEffect(() => {
    if (!focus || handledFocus.current === focus.nonce || !viewport) return
    const member = members.find((m) => m.id === focus.memberId)
    if (!member?.label_bbox) return
    if (Math.abs(viewport.scale - zoom) > 0.001) return // wait for the re-rendered viewport
    handledFocus.current = focus.nonce
    const box = scrollRef.current
    const layer = layerRef.current
    if (!box || !layer) return
    const rect = toViewportRect(viewport, member.label_bbox)
    box.scrollTo({
      left: layer.offsetLeft + rect.x + rect.width / 2 - box.clientWidth / 2,
      top: layer.offsetTop + rect.y + rect.height / 2 - box.clientHeight / 2,
      behavior: 'smooth',
    })
  }, [focus, viewport, zoom, members])

  // Esc leaves placement mode.
  const { placing, onCancelPlace, onPlace } = props
  useEffect(() => {
    if (!placing) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancelPlace?.()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [placing, onCancelPlace])

  const placeAt = (event: React.MouseEvent) => {
    const layer = layerRef.current
    if (!layer || !viewport) return
    const box = layer.getBoundingClientRect()
    const [x, y] = viewport.convertToPdfPoint(event.clientX - box.left, event.clientY - box.top) as [number, number]
    onPlace?.([Math.round(x * 10) / 10, Math.round(y * 10) / 10])
  }

  const step = (direction: 1 | -1) => {
    setFit(null)
    setZoom((z) => {
      const candidates = direction === 1 ? ZOOM_STEPS.filter((s) => s > z + 0.001) : ZOOM_STEPS.filter((s) => s < z - 0.001)
      return direction === 1 ? (candidates[0] ?? MAX_ZOOM) : (candidates[candidates.length - 1] ?? MIN_ZOOM)
    })
  }

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    step(event.deltaY < 0 ? 1 : -1)
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !scrollRef.current) return
    if (placing && props.boxing && layerRef.current) {
      const at = layerRef.current.getBoundingClientRect()
      boxStart.current = { x: event.clientX - at.left, y: event.clientY - at.top }
      setBand(null)
      return
    }
    drag.current = { x: event.clientX, y: event.clientY, left: scrollRef.current.scrollLeft, top: scrollRef.current.scrollTop, moved: false }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = boxStart.current
    if (start && layerRef.current) {
      const at = layerRef.current.getBoundingClientRect()
      const x = event.clientX - at.left
      const y = event.clientY - at.top
      if (Math.hypot(x - start.x, y - start.y) < DRAG_THRESHOLD) return
      setBand({ left: Math.min(x, start.x), top: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) })
      return
    }
    const d = drag.current
    if (!d || !scrollRef.current) return
    const dx = event.clientX - d.x
    const dy = event.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    d.moved = true
    scrollRef.current.scrollLeft = d.left - dx
    scrollRef.current.scrollTop = d.top - dy
  }
  const onPointerUp = () => {
    const start = boxStart.current
    boxStart.current = null
    if (!start || !band || !viewport) return
    const [x1, y1] = viewport.convertToPdfPoint(band.left, band.top) as [number, number]
    const [x2, y2] = viewport.convertToPdfPoint(band.left + band.width, band.top + band.height) as [number, number]
    const r = (v: number) => Math.round(v * 10) / 10
    boxed.current = true
    setBand(null)
    props.onBox?.([r(Math.min(x1, x2)), r(Math.min(y1, y2)), r(Math.max(x1, x2)), r(Math.max(y1, y2))])
  }
  // A drag must not count as a click on a member (or as a click clearing the selection).
  const onClickCapture = (event: React.MouseEvent) => {
    if (boxed.current) {
      boxed.current = false
      event.stopPropagation()
      event.preventDefault()
      return
    }
    if (drag.current?.moved) {
      event.stopPropagation()
      event.preventDefault()
    }
    drag.current = null
  }

  return (
    <section className="stage" aria-label="Drawing">
      <div className="stage__toolbar" role="toolbar" aria-label="Drawing tools">
        {props.toolbar}
        <div className="stage__zoom">
          <Button onClick={() => step(-1)} disabled={zoom <= MIN_ZOOM} aria-label="Zoom out">
            −
          </Button>
          <span className="viewer__zoom-value" aria-live="polite">
            {Math.round(zoom * 100)}%
          </span>
          <Button onClick={() => step(1)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in">
            +
          </Button>
          <Button aria-pressed={fit === 'width'} onClick={() => setFit('width')}>
            Fit width
          </Button>
          <Button aria-pressed={fit === 'page'} onClick={() => setFit('page')}>
            Fit page
          </Button>
          <Button
            aria-pressed={!fit && zoom === 1}
            onClick={() => {
              setFit(null)
              setZoom(1)
            }}
          >
            100%
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="viewer__scroll stage__scroll"
        tabIndex={0}
        aria-label="Drawing area. Use arrow keys or drag to move around; Ctrl and mouse wheel to zoom."
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClickCapture={(event) => {
          onClickCapture(event)
          if (placing && !event.defaultPrevented) {
            event.stopPropagation()
            placeAt(event)
          }
        }}
        onClick={() => props.onSelect(null)}
        data-placing={placing || undefined}
      >
        {placing && (
          <p className="stage__placing" role="status">
            {props.placingHint ?? 'Click the drawing where the member is'} · Esc to cancel
          </p>
        )}
        {pdfState.isPending && <LoadingState label={downloadLabel(download)} />}
        {pdfState.error && (
          <ErrorState title="The drawing could not be loaded" error={pdfState.error} onRetry={() => void pdfState.refetch()} />
        )}
        {pdfState.data && (
          <div ref={layerRef} className="page-layer">
            <PdfPageCanvas
              key={pageNumber}
              doc={pdfState.data}
              pageNumber={pageNumber}
              zoom={zoom}
              label={label}
              onViewport={onViewport}
            />
            {props.showGrids && props.grids && props.grids.length > 0 && viewport && Math.abs(viewport.scale - zoom) < 0.001 && (
              <GridOverlay viewport={viewport} grids={props.grids} />
            )}
            {showLabels && viewport && Math.abs(viewport.scale - zoom) < 0.001 && (
              <MemberOverlay
                viewport={viewport}
                members={members}
                selectedId={props.selectedId}
                hoveredId={props.hoveredId}
                onSelect={props.onSelect}
                onHover={props.onHover}
              />
            )}
            {showLabels && props.columns && props.columns.length > 0 && viewport && Math.abs(viewport.scale - zoom) < 0.001 && (
              <ColumnOverlay viewport={viewport} columns={props.columns} />
            )}
            {props.area && viewport && Math.abs(viewport.scale - zoom) < 0.001 && (
              <AreaOverlay viewport={viewport} area={props.area} />
            )}
            {props.marker && viewport && Math.abs(viewport.scale - zoom) < 0.001 && (
              <PointMarker viewport={viewport} {...props.marker} />
            )}
            {band && <div className="stage__band" style={band} aria-hidden="true" />}
          </div>
        )}
      </div>
    </section>
  )
}

/** The page's area: everything outside it dimmed (not counted), the box outlined. */
function AreaOverlay({ viewport, area }: { viewport: PageViewport; area: [number, number, number, number] }) {
  const [x1, y1] = viewport.convertToViewportPoint(area[0], area[3]) as [number, number]
  const [x2, y2] = viewport.convertToViewportPoint(area[2], area[1]) as [number, number]
  const [left, right, top, bottom] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)]
  const { width, height } = viewport
  return (
    <svg className="area-overlay" width={width} height={height} aria-hidden="true">
      <path
        fillRule="evenodd"
        d={`M0 0H${width}V${height}H0Z M${left} ${top}H${right}V${bottom}H${left}Z`}
        className="area-overlay__outside"
      />
      <rect x={left} y={top} width={right - left} height={bottom - top} className="area-overlay__box">
        <title>The area counted on this page</title>
      </rect>
    </svg>
  )
}

function PointMarker({ viewport, point, label }: { viewport: PageViewport; point: [number, number]; label: string }) {
  const [x, y] = viewport.convertToViewportPoint(point[0], point[1]) as [number, number]
  return (
    <svg className="point-marker" width={viewport.width} height={viewport.height} aria-hidden="true">
      <circle cx={x} cy={y} r={12} />
      <line x1={x - 20} y1={y} x2={x + 20} y2={y} />
      <line x1={x} y1={y - 20} x2={x} y2={y + 20} />
      <text x={x + 16} y={y - 14}>{label}</text>
    </svg>
  )
}

/** A box around each column symbol found on the plan (outline + legend text, not colour alone). */
function ColumnOverlay({ viewport, columns }: { viewport: PageViewport; columns: ColumnSymbol[] }) {
  const half = 9 // PDF points: just larger than the symbol
  return (
    <svg className="column-overlay" width={viewport.width} height={viewport.height} aria-hidden="true">
      {columns.map((c) => {
        const [x1, y1] = viewport.convertToViewportPoint(c.x - half, c.y + half) as [number, number]
        const [x2, y2] = viewport.convertToViewportPoint(c.x + half, c.y - half) as [number, number]
        const title = <title>{describeColumn(c)}</title>
        return c.shape === 'round_tube' ? (
          <circle key={`${c.x},${c.y}`} cx={(x1 + x2) / 2} cy={(y1 + y2) / 2} r={Math.abs(x2 - x1) / 2} data-shape={c.shape}>
            {title}
          </circle>
        ) : (
          <rect
            key={`${c.x},${c.y}`}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            data-shape={c.shape ?? 'wide_flange'}
          >
            {title}
          </rect>
        )
      })}
    </svg>
  )
}

/** Grid lines found on the plan, with their labels at each bubble. A line whose extent was
 *  inferred from a short stub is drawn fainter. */
function GridOverlay({ viewport, grids }: { viewport: PageViewport; grids: GridLine[] }) {
  return (
    <svg className="grid-overlay" width={viewport.width} height={viewport.height} aria-hidden="true">
      {grids.map((g, i) => {
        const [x1, y1] = viewport.convertToViewportPoint(g.x1, g.y1) as [number, number]
        const [x2, y2] = viewport.convertToViewportPoint(g.x2, g.y2) as [number, number]
        const note = g.secondary ? ' (another line is the real grid; no grid points here)' : g.drawn ? '' : ' (only a stub is drawn; position inferred)'
        const title = <title>{`Grid ${g.label}${note}`}</title>
        return (
          <g key={`${g.label}-${i}`} data-drawn={g.drawn} data-secondary={g.secondary ? 'true' : undefined}>
            {g.arc ? (
              <polyline points={arcPoints(viewport, g.arc)} fill="none">
                {title}
              </polyline>
            ) : (
              <line x1={x1} y1={y1} x2={x2} y2={y2}>
                {title}
              </line>
            )}
            {g.bubbles.map(([bx = 0, by = 0, r = 9]) => {
              const [cx, cy] = viewport.convertToViewportPoint(bx, by) as [number, number]
              const radius = Math.max(r * viewport.scale, 6) + 3
              return (
                <g key={`${bx},${by}`}>
                  <circle cx={cx} cy={cy} r={radius} />
                  <text x={cx} y={cy - radius - 4}>
                    {g.label}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}

/** A curved grid line (OD-33) as screen points along its arc. */
function arcPoints(viewport: PageViewport, arc: { cx: number; cy: number; r: number; a0: number; a1: number }): string {
  const steps = Math.max(8, Math.ceil(((arc.a1 - arc.a0) * 180) / Math.PI / 3))
  return Array.from({ length: steps + 1 }, (_, i) => {
    const a = arc.a0 + ((arc.a1 - arc.a0) * i) / steps
    const [x, y] = viewport.convertToViewportPoint(arc.cx + arc.r * Math.cos(a), arc.cy + arc.r * Math.sin(a)) as [number, number]
    return `${x},${y}`
  }).join(' ')
}

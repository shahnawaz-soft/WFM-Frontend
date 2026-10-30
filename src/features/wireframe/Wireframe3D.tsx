import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { WireframeElement, WireframeGrid } from '../../api/types'
import { signedFeetInches } from '../abm/format'
import { elementPoints } from './elementPoints'
import { gridSegments } from './gridGeometry'

export type CameraView = '3d' | 'top' | 'front' | 'side'

/** What the view says about a column: its mark, section, height and levels (Column Scheduler). */
export interface ColumnLabel {
  mark: string
  designation: string
  height_display: string
  bottom_level: string
  top_level: string
}

interface Wireframe3DProps {
  elements: WireframeElement[]
  selectedId: string | null
  /** Columns picked in the schedule or here with Ctrl+click: highlighted, with their heights. */
  marked?: Set<string>
  columns?: Map<string, ColumnLabel>
  /** Every column's height, not only the picked ones. */
  allHeights?: boolean
  view: CameraView
  viewNonce: number
  /** What a left-drag does (the switch above the view); a right-drag does the other. */
  dragMode?: 'turn' | 'move'
  /** ``additive``: Ctrl/⌘+click adds to (or takes from) the picked columns. */
  onSelect: (id: string | null, additive?: boolean) => void
  /** The project's grid lines (mm), drawn at the lowest level; none: a plain helper grid. */
  grids?: WireframeGrid[]
  showGrids?: boolean
}

const COLORS = { beam: '#2563eb', column: '#c2410c', selected: '#7c3aed', added: '#15803d', hover: '#db2777' }
// Column ends are told apart: the bottom (where it stands) green, the top red.
const END_COLORS = { bottom: '#15803d', top: '#b91c1c', dimension: '#334155' }

interface Placed {
  e: WireframeElement
  a: THREE.Vector3
  b: THREE.Vector3
  /** Every point it is drawn through: two for straight members, more for curved ones. */
  points: THREE.Vector3[]
}

function placed(elements: WireframeElement[]): Placed[] {
  return elements.flatMap((e) => {
    const points = elementPoints(e)?.map((p) => new THREE.Vector3(...p))
    return points ? [{ e, a: points[0]!, b: points[points.length - 1]!, points }] : []
  })
}

/** What each flat view looks along, which way is up on screen, and which two model axes it shows. */
const FLAT: Record<Exclude<CameraView, '3d'>, { look: THREE.Vector3; up: THREE.Vector3; axes: ['x' | 'y' | 'z', 'x' | 'y' | 'z'] }> = {
  top: { look: new THREE.Vector3(0, 0, 1), up: new THREE.Vector3(0, 1, 0), axes: ['x', 'y'] }, // plan, north up
  front: { look: new THREE.Vector3(0, -1, 0), up: new THREE.Vector3(0, 0, 1), axes: ['x', 'z'] },
  side: { look: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 0, 1), axes: ['y', 'z'] },
}

/** three.js cameras and controls are mutable objects: point them at the model. */
function aimPerspective(camera: THREE.PerspectiveCamera, controls: OrbitControls, box: THREE.Box3, aspect: number) {
  const centre = box.getCenter(new THREE.Vector3())
  const reach = box.getSize(new THREE.Vector3()).length() || 10_000
  camera.aspect = aspect
  camera.near = reach / 1000
  camera.far = reach * 20
  camera.up.set(0, 0, 1) // project z is up
  camera.position.copy(centre).add(new THREE.Vector3(-0.72, -0.96, 0.72).multiplyScalar(reach))
  camera.updateProjectionMatrix()
  controls.enableRotate = true
  controls.target.copy(centre)
  controls.update()
}

function aimFlat(camera: THREE.OrthographicCamera, controls: OrbitControls, box: THREE.Box3, view: Exclude<CameraView, '3d'>, aspect: number) {
  const centre = box.getCenter(new THREE.Vector3())
  const extent = box.getSize(new THREE.Vector3())
  const reach = extent.length() || 10_000
  const { look, up, axes } = FLAT[view]
  const [w, h] = [extent[axes[0]] || 10_000, extent[axes[1]] || 10_000]
  const half = Math.max(h / 2, w / 2 / aspect) * 1.1 // the whole model, with a margin
  Object.assign(camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half, zoom: 1, near: 1, far: reach * 20 })
  camera.up.copy(up)
  camera.position.copy(centre).addScaledVector(look, reach * 2)
  camera.updateProjectionMatrix()
  controls.enableRotate = false // a flat view stays flat: pan and zoom only
  controls.target.copy(centre)
  controls.update()
}

/** The 3D view in perspective; Top, Front and Side are orthographic: true proportions, and
 *  columns stay points (top) or upright (front, side) instead of leaning with perspective. */
function CameraRig({ box, view, nonce, dragMode }: { box: THREE.Box3; view: CameraView; nonce: number; dragMode: 'turn' | 'move' }) {
  const { gl, size, set, invalidate } = useThree()
  const perspective = useMemo(() => {
    const camera = new THREE.PerspectiveCamera(45, 1, 1, 1e7)
    // Z is up in the project. OrbitControls reads "up" once, when it is made: set it first, or
    // dragging tumbles the model about the wrong axis (19 Oct 2026).
    camera.up.set(0, 0, 1)
    return camera
  }, [])
  const ortho = useMemo(() => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e7)
    ;(camera as THREE.OrthographicCamera & { manual: boolean }).manual = true // we size it, not R3F
    camera.up.copy(FLAT[view === '3d' ? 'top' : view].up)
    return camera
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remade per flat view, below
  }, [view])
  const camera = view === '3d' ? perspective : ortho
  useLayoutEffect(() => set({ camera }), [camera, set])
  const controls = useMemo(() => {
    const c = new OrbitControls(camera, gl.domElement)
    // As in other 3D viewers: eased motion, zoom towards the cursor, pan in the screen plane.
    c.enableDamping = true
    c.dampingFactor = 0.12
    c.rotateSpeed = 0.7
    c.zoomSpeed = 1.2
    c.zoomToCursor = true
    c.screenSpacePanning = true
    return c
  }, [camera, gl])
  // The canvas draws on demand: each camera move (drag, wheel, and every damping step, which
  // controls.update() below reports as a change until the motion settles) asks for a frame.
  useEffect(() => {
    const redraw = () => invalidate()
    controls.addEventListener('change', redraw)
    return () => {
      controls.removeEventListener('change', redraw)
      controls.dispose()
    }
  }, [controls, invalidate])
  // The switch above the view: what a left-drag does; a right-drag does the other.
  useEffect(() => {
    const [turn, move] = [THREE.MOUSE.ROTATE, THREE.MOUSE.PAN]
    controls.mouseButtons = { LEFT: dragMode === 'move' ? move : turn, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: dragMode === 'move' ? turn : move }
  }, [controls, dragMode])
  useFrame(() => controls.update()) // damping needs an update each frame

  useEffect(() => {
    if (view === '3d') aimPerspective(perspective, controls, box, size.width / Math.max(size.height, 1))
    else aimFlat(ortho, controls, box, view, size.width / Math.max(size.height, 1))
    invalidate()
  }, [box, view, nonce, size, perspective, ortho, controls, invalidate])
  return null
}

/** Every element in one line object (one draw call, one hit test), coloured per element; a
 *  click maps the segment hit back to its element. 931 separate objects made orbiting stutter:
 *  each was hit-tested on every pointer move. */
function Elements3D({
  items,
  onSelect,
  onHover,
}: {
  items: Placed[]
  onSelect: (id: string, additive: boolean) => void
  /** The element under the pointer (null: none) and where the pointer is, on every move. */
  onHover: (id: string | null, x?: number, y?: number) => void
}) {
  const { lines, owners } = useMemo(() => {
    const positions: number[] = []
    const colours: number[] = []
    const owners: string[] = [] // element id per segment
    const colour = new THREE.Color()
    for (const p of items) {
      colour.set(p.e.provenance === 'added' ? COLORS.added : COLORS[p.e.element_type])
      for (let i = 0; i < p.points.length - 1; i++) {
        const [a, b] = [p.points[i]!, p.points[i + 1]!]
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z)
        colours.push(colour.r, colour.g, colour.b, colour.r, colour.g, colour.b)
        owners.push(p.e.id)
      }
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3))
    geometry.computeBoundingSphere()
    return { lines: new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })), owners }
  }, [items])
  useEffect(
    () => () => {
      lines.geometry.dispose()
      lines.material.dispose()
    },
    [lines],
  )

  // The member under the cursor: of the segments within reach, the one nearest the ray (the
  // first hit is only the nearest to the camera).
  const ownerOf = (event: ThreeEvent<PointerEvent | MouseEvent>): string | undefined => {
    let best: { index: number; gap: number } | null = null
    for (const hit of event.intersections) {
      if (hit.object !== lines || hit.index == null) continue
      const gap = event.ray.distanceToPoint((hit as { pointOnLine?: THREE.Vector3 }).pointOnLine ?? hit.point)
      if (!best || gap < best.gap) best = { index: hit.index, gap }
    }
    return best ? owners[Math.floor(best.index / 2)] : undefined
  }
  return (
    <primitive
      object={lines}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        event.stopPropagation()
        if (event.delta > 4) return // the end of an orbit drag, not a pick
        const id = ownerOf(event)
        if (id) onSelect(id, event.nativeEvent.ctrlKey || event.nativeEvent.metaKey)
      }}
      onPointerMove={(event: ThreeEvent<PointerEvent>) => {
        if (event.nativeEvent.buttons) return // orbiting: no hover work while dragging
        const id = ownerOf(event)
        onHover(id ?? null, event.nativeEvent.offsetX, event.nativeEvent.offsetY)
      }}
      onPointerOut={() => onHover(null)}
    />
  )
}

/** The two highlight looks, shared by every highlighted element for the life of the page: hovering
 *  or selecting makes a new line, never a new material (nor its GPU program). */
const HIGHLIGHT = {
  selected: new THREE.LineBasicMaterial({ color: COLORS.selected, depthTest: false }),
  hover: new THREE.LineBasicMaterial({ color: COLORS.hover, depthTest: false }),
}

function Selected3D({ p, tone = 'selected' }: { p: Placed; tone?: keyof typeof HIGHLIGHT }) {
  const line = useMemo(() => {
    const object = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.points), HIGHLIGHT[tone])
    object.renderOrder = 1 // drawn over the rest
    return object
  }, [p, tone])
  useEffect(() => () => line.geometry.dispose(), [line])
  return <primitive object={line} />
}

/** Each column's height as a drawing shows it: a dimension line beside the column with ticks
 *  and extension lines at its ends, and the bottom (green) and top (red) of the column marked.
 *  The height itself is a tag over the view (``HeightTags``). */
function ColumnDimensions({ items, reach }: { items: Placed[]; reach: number }) {
  const group = useMemo(() => {
    const g = new THREE.Group()
    const offset = new THREE.Vector3(Math.max(reach / 60, 300), 0, 0)
    const tick = new THREE.Vector3(1, 0, 1).normalize().multiplyScalar(offset.x * 0.35)
    const lines: number[] = []
    const ends: number[] = []
    const endColours: number[] = []
    const bottom = new THREE.Color(END_COLORS.bottom)
    const top = new THREE.Color(END_COLORS.top)
    for (const p of items) {
      const [low, high] = p.a.z <= p.b.z ? [p.a, p.b] : [p.b, p.a]
      const [d0, d1] = [low.clone().add(offset), high.clone().add(offset)]
      const ext = offset.clone().multiplyScalar(1.25)
      const push = (u: THREE.Vector3, v: THREE.Vector3) => lines.push(u.x, u.y, u.z, v.x, v.y, v.z)
      push(low, low.clone().add(ext)) // extension lines
      push(high, high.clone().add(ext))
      push(d0, d1) // the dimension line
      push(d0.clone().sub(tick), d0.clone().add(tick)) // ticks
      push(d1.clone().sub(tick), d1.clone().add(tick))
      ends.push(low.x, low.y, low.z, high.x, high.y, high.z)
      endColours.push(bottom.r, bottom.g, bottom.b, top.r, top.g, top.b)
    }
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3))
    const dims = new THREE.LineSegments(lineGeometry, new THREE.LineBasicMaterial({ color: END_COLORS.dimension, depthTest: false }))
    dims.renderOrder = 2
    g.add(dims)
    const endGeometry = new THREE.BufferGeometry()
    endGeometry.setAttribute('position', new THREE.Float32BufferAttribute(ends, 3))
    endGeometry.setAttribute('color', new THREE.Float32BufferAttribute(endColours, 3))
    const points = new THREE.Points(endGeometry, new THREE.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: false }))
    points.renderOrder = 2
    g.add(points)
    return g
  }, [items, reach])
  useEffect(
    () => () => {
      group.traverse((o) => {
        if (o instanceof THREE.LineSegments || o instanceof THREE.Points) {
          o.geometry.dispose()
          o.material.dispose()
        }
      })
    },
    [group],
  )
  return <primitive object={group} />
}

const GRID_COLOR = '#64748b'

/** The structural grid at the foot of the model: dashed lines, each labelled in a bubble at
 *  both ends, as on the plans. */
function Grids3D({ grids, box }: { grids: WireframeGrid[]; box: THREE.Box3 }) {
  const { lines, labels } = useMemo(() => {
    const plan = { minX: box.min.x, minY: box.min.y, maxX: box.max.x, maxY: box.max.y }
    const segments = gridSegments(grids, plan)
    const z = box.min.z
    const positions = segments.flatMap((s) => [s.from[0], s.from[1], z, s.to[0], s.to[1], z])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    const size = Math.max(box.max.x - box.min.x, box.max.y - box.min.y, 1)
    const lines = new THREE.LineSegments(
      geometry,
      new THREE.LineDashedMaterial({ color: GRID_COLOR, dashSize: size / 80, gapSize: size / 160 }),
    )
    lines.computeLineDistances()
    const bubble = size / 45
    const labels = segments.flatMap((s) =>
      [s.from, s.to].map((end, i) => {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTexture(s.label), depthTest: false }))
        sprite.position.set(end[0], end[1], z)
        sprite.scale.set(bubble, bubble, 1)
        sprite.name = `${s.label}:${i}`
        return sprite
      }),
    )
    return { lines, labels }
  }, [grids, box])
  useEffect(
    () => () => {
      lines.geometry.dispose()
      ;(lines.material as THREE.Material).dispose()
      for (const l of labels) {
        l.material.map?.dispose()
        l.material.dispose()
      }
    },
    [lines, labels],
  )
  return (
    <group name="grids" raycast={() => null}>
      <primitive object={lines} raycast={() => null} />
      {labels.map((l) => (
        <primitive key={l.name} object={l} raycast={() => null} />
      ))}
    </group>
  )
}

/** A grid bubble: the label in a circle, drawn once per label. */
function bubbleTexture(label: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.strokeStyle = GRID_COLOR
    ctx.lineWidth = 6
    ctx.beginPath()
    ctx.arc(64, 64, 58, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#1e293b'
    ctx.font = `bold ${label.length > 3 ? 34 : 48}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 64, 66)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

interface PlacedTag {
  el: HTMLElement
  x: number
  y: number
  depth: number
  w: number
  h: number
}

/** Where each column's height tag goes on screen: beside the middle of its dimension line.
 *  Tags that would cover one already placed (nearer columns first) are hidden, so they stay
 *  readable; zooming in shows more. Moved directly in the page (no re-render), and only when
 *  the camera, the view's size or the tags change. Tag sizes are measured once per change of
 *  the tags, so placing them only writes to the page (no layout per tag). */
function HeightTags({ items, reach, overlay }: { items: Placed[]; reach: number; overlay: React.RefObject<HTMLDivElement | null> }) {
  const { invalidate } = useThree()
  const point = useMemo(() => new THREE.Vector3(), [])
  const offset = Math.max(reach / 60, 300) * 1.6
  // What the tags were last placed for: the camera, its matrices and the view's size.
  const last = useRef({ camera: null as THREE.Camera | null, world: new THREE.Matrix4(), projection: new THREE.Matrix4(), width: 0, height: 0 })
  const remeasure = useRef(true)
  const sizes = useRef<{ w: number; h: number }[]>([])
  const pool = useRef<PlacedTag[]>([]) // reused between placements
  const order = useRef<PlacedTag[]>([])
  const taken = useRef<number[]>([]) // boxes of the tags shown, four numbers each

  // The tags (which ones, their text) may have changed with this render: measure and place again.
  useLayoutEffect(() => {
    remeasure.current = true
    invalidate()
  })

  useFrame(({ camera, size }) => {
    const tags = overlay.current?.children
    if (!tags) return
    camera.updateMatrixWorld() // as the coming render will: tags match this frame, not the last
    const seen = last.current
    const moved =
      seen.camera !== camera ||
      seen.width !== size.width ||
      seen.height !== size.height ||
      !seen.world.equals(camera.matrixWorld) ||
      !seen.projection.equals(camera.projectionMatrix)
    if (!moved && !remeasure.current) return
    seen.camera = camera
    seen.width = size.width
    seen.height = size.height
    seen.world.copy(camera.matrixWorld)
    seen.projection.copy(camera.projectionMatrix)

    // Reads first, all at once: the page lays out at most once.
    if (remeasure.current) {
      sizes.current = Array.from(tags, (el) => ({ w: (el as HTMLElement).offsetWidth || 60, h: (el as HTMLElement).offsetHeight || 18 }))
      remeasure.current = false
    }
    const placed = order.current
    placed.length = 0
    items.forEach((p, i) => {
      const el = tags[i] as HTMLElement | undefined
      const measured = sizes.current[i]
      if (!el || !measured) return
      point.copy(p.a).add(p.b).multiplyScalar(0.5)
      point.x += offset
      point.project(camera)
      const behind = point.z > 1 || point.z < -1
      const t = (pool.current[i] ??= { el, x: 0, y: 0, depth: 0, w: 0, h: 0 })
      t.el = el
      t.x = ((point.x + 1) / 2) * size.width
      t.y = ((1 - point.y) / 2) * size.height
      t.depth = behind ? Infinity : point.z
      t.w = measured.w
      t.h = measured.h
      placed.push(t)
    })
    placed.sort((a, b) => a.depth - b.depth)

    // Then writes only.
    const boxes = taken.current
    boxes.length = 0
    for (const t of placed) {
      const [x0, y0, x1, y1] = [t.x - 2, t.y - t.h / 2 - 2, t.x + t.w + 2, t.y + t.h / 2 + 2]
      let clash = false
      for (let b = 0; b < boxes.length && !clash; b += 4) {
        clash = x0 < boxes[b + 2]! && boxes[b]! < x1 && y0 < boxes[b + 3]! && boxes[b + 1]! < y1
      }
      const picked = t.el.dataset.picked !== undefined
      const off = t.depth === Infinity || t.x < 0 || t.y < 0 || t.x > size.width || t.y > size.height
      if (off || (clash && !picked)) {
        t.el.style.visibility = 'hidden'
        continue
      }
      boxes.push(x0, y0, x1, y1)
      t.el.style.visibility = 'visible'
      t.el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y - t.h / 2)}px)`
    }
  })
  return null
}

/** Interactive 3D view of the wireframe: orbit (drag), zoom (wheel), pick (click; Ctrl+click
 *  to pick several), hover a column for its mark, section, height and levels. */
export default function Wireframe3D({
  elements,
  selectedId,
  marked,
  columns,
  allHeights = false,
  view,
  viewNonce,
  dragMode = 'turn',
  onSelect,
  grids,
  showGrids = true,
}: Wireframe3DProps) {
  const items = useMemo(() => placed(elements), [elements])
  // Only which element is hovered is state: the pointer moves the tooltip directly, so a move
  // within the same element re-renders nothing.
  const [hoverId, setHoverId] = useState<string | null>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const tooltip = useRef<HTMLDivElement>(null)
  const placeTooltip = useCallback(() => {
    const el = tooltip.current
    if (!el) return
    el.style.left = `${pointer.current.x + 14}px`
    el.style.top = `${pointer.current.y + 14}px`
  }, [])
  const onHover = useCallback(
    (id: string | null, x = 0, y = 0) => {
      pointer.current.x = x
      pointer.current.y = y
      placeTooltip()
      setHoverId(id) // the same id again: no re-render
    },
    [placeTooltip],
  )
  const box = useMemo(() => {
    const b = new THREE.Box3()
    for (const p of items) b.expandByPoint(p.a).expandByPoint(p.b)
    if (b.isEmpty()) b.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10_000, 10_000, 3_000))
    return b
  }, [items])
  const size = box.getSize(new THREE.Vector3())
  const grid = Math.max(size.x, size.y, 10_000) * 1.2
  const centre = box.getCenter(new THREE.Vector3())
  const picked = useMemo(() => items.filter((p) => p.e.id === selectedId || marked?.has(p.e.id)), [items, selectedId, marked])
  const hovered = hoverId ? items.find((p) => p.e.id === hoverId) : undefined
  const dimensioned = useMemo(() => {
    const shown = items.filter(
      (p) => p.e.element_type === 'column' && (allHeights || p.e.id === selectedId || marked?.has(p.e.id) || p.e.id === hoverId),
    )
    return shown
  }, [items, allHeights, selectedId, marked, hoverId])
  const hoverLabel = hovered && hovered.e.element_type === 'column' ? columns?.get(hovered.e.id) : undefined
  // The tooltip appears with the hovered element: put it at the pointer before it is painted.
  useLayoutEffect(placeTooltip, [hoverId, placeTooltip])
  const overlay = useRef<HTMLDivElement>(null)
  const tagText = (p: Placed) => {
    const label = columns?.get(p.e.id)
    const height = label?.height_display || signedFeetInches(String(Math.abs(p.b.z - p.a.z))) || ''
    return label?.mark ? `${label.mark} · ${height}` : height
  }

  return (
    <div className="wf3d__viewport">
      <Canvas
        className="wf3d__canvas"
        // Drawn only when something changes (camera moves, scene objects added, removed or
        // updated), not 60 times a second while the model sits still.
        frameloop="demand"
        camera={{ fov: 45 }}
        dpr={[1, 2]}
        raycaster={{ params: { Line: { threshold: Math.max(grid / 300, 50) } } as THREE.RaycasterParameters }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#f8fafc']} />
        <CameraRig box={box} view={view} nonce={viewNonce} dragMode={dragMode} />
        {grids && grids.length > 0 ? (
          showGrids && <Grids3D grids={grids} box={box} />
        ) : (
          <gridHelper
            args={[grid, 20, '#cbd5e1', '#e2e8f0']}
            position={[centre.x, centre.y, box.min.z]}
            rotation={[Math.PI / 2, 0, 0]}
          />
        )}
        <Elements3D items={items} onSelect={onSelect} onHover={onHover} />
        {picked.map((p) => (
          <Selected3D key={p.e.id} p={p} />
        ))}
        {hovered && !picked.includes(hovered) && <Selected3D p={hovered} tone="hover" />}
        {dimensioned.length > 0 && <ColumnDimensions items={dimensioned} reach={size.length()} />}
        <HeightTags items={dimensioned} reach={size.length()} overlay={overlay} />
      </Canvas>
      <div className="wf3d__tags" ref={overlay}>
        {dimensioned.map((p) => (
          <button
            key={p.e.id}
            type="button"
            className="wf3d__tag"
            data-picked={p.e.id === selectedId || marked?.has(p.e.id) || undefined}
            style={{ visibility: 'hidden' }}
            title={`${columns?.get(p.e.id)?.designation || 'Column'}: ${columns?.get(p.e.id)?.bottom_level || '?'} → ${columns?.get(p.e.id)?.top_level || '?'}. Click to select (Ctrl+click: add to the selection).`}
            onClick={(event) => onSelect(p.e.id, event.ctrlKey || event.metaKey)}
          >
            {tagText(p)}
          </button>
        ))}
      </div>
      {hovered && (
        <div className="wf3d__tooltip" role="tooltip" ref={tooltip}>
          {hoverLabel ? (
            <>
              <strong>
                {hoverLabel.mark && `${hoverLabel.mark} · `}
                {hoverLabel.designation || 'Size not given'}
              </strong>
              <span>
                {hoverLabel.height_display}
                {(hoverLabel.bottom_level || hoverLabel.top_level) &&
                  ` · ${hoverLabel.bottom_level || '?'} → ${hoverLabel.top_level || '?'}`}
              </span>
            </>
          ) : (
            <strong>
              {hovered.e.element_type === 'column' ? 'Column' : 'Beam'} {hovered.e.designation || ''} {hovered.e.length_display && `· ${hovered.e.length_display}`}
            </strong>
          )}
          <span className="muted">Click to edit · Ctrl+click to add to the selection</span>
        </div>
      )}
    </div>
  )
}

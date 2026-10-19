import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

import type { WireframeElement } from '../../api/types'
import { elementPoints } from './elementPoints'

export type CameraView = '3d' | 'top' | 'front' | 'side'

interface Wireframe3DProps {
  elements: WireframeElement[]
  selectedId: string | null
  view: CameraView
  viewNonce: number
  onSelect: (id: string | null) => void
}

const COLORS = { beam: '#2563eb', column: '#c2410c', selected: '#7c3aed', added: '#15803d' }

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
function CameraRig({ box, view, nonce }: { box: THREE.Box3; view: CameraView; nonce: number }) {
  const { gl, size, set } = useThree()
  const perspective = useMemo(() => new THREE.PerspectiveCamera(45, 1, 1, 1e7), [])
  const ortho = useMemo(() => {
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1e7)
    ;(camera as THREE.OrthographicCamera & { manual: boolean }).manual = true // we size it, not R3F
    return camera
  }, [])
  const camera = view === '3d' ? perspective : ortho
  useLayoutEffect(() => set({ camera }), [camera, set])
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => () => controls.dispose(), [controls])

  useEffect(() => {
    if (view === '3d') aimPerspective(perspective, controls, box, size.width / Math.max(size.height, 1))
    else aimFlat(ortho, controls, box, view, size.width / Math.max(size.height, 1))
  }, [box, view, nonce, size, perspective, ortho, controls])
  return null
}

function Element3D({ p, selected, onSelect }: { p: Placed; selected: boolean; onSelect: (id: string) => void }) {
  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints(p.points)
    const color = selected ? COLORS.selected : p.e.provenance === 'added' ? COLORS.added : COLORS[p.e.element_type]
    return new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, linewidth: selected ? 3 : 1 }))
  }, [p, selected])
  useEffect(() => () => line.geometry.dispose(), [line])
  return (
    <primitive
      object={line}
      onClick={(event: { stopPropagation: () => void }) => {
        event.stopPropagation()
        onSelect(p.e.id)
      }}
    />
  )
}

/** Interactive 3D view of the wireframe: orbit (drag), zoom (wheel), pick (click). */
export default function Wireframe3D({ elements, selectedId, view, viewNonce, onSelect }: Wireframe3DProps) {
  const items = useMemo(() => placed(elements), [elements])
  const box = useMemo(() => {
    const b = new THREE.Box3()
    for (const p of items) b.expandByPoint(p.a).expandByPoint(p.b)
    if (b.isEmpty()) b.set(new THREE.Vector3(0, 0, 0), new THREE.Vector3(10_000, 10_000, 3_000))
    return b
  }, [items])
  const size = box.getSize(new THREE.Vector3())
  const grid = Math.max(size.x, size.y, 10_000) * 1.2
  const centre = box.getCenter(new THREE.Vector3())

  return (
    <Canvas
      className="wf3d__canvas"
      camera={{ fov: 45 }}
      raycaster={{ params: { Line: { threshold: Math.max(grid / 300, 50) } } as THREE.RaycasterParameters }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={['#f8fafc']} />
      <CameraRig box={box} view={view} nonce={viewNonce} />
      <gridHelper
        args={[grid, 20, '#cbd5e1', '#e2e8f0']}
        position={[centre.x, centre.y, box.min.z]}
        rotation={[Math.PI / 2, 0, 0]}
      />
      {items.map((p) => (
        <Element3D key={p.e.id} p={p} selected={p.e.id === selectedId} onSelect={onSelect} />
      ))}
    </Canvas>
  )
}

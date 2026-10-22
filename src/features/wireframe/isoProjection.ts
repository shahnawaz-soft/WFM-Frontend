/** The simple (no-WebGL) view's maths: frame, projection and picking. */

import type { WireframeElement } from '../../api/types'
import type { CameraView } from './Wireframe3D'

export const HEIGHT = 520
const PAD = 24
const DEG = Math.PI / 180
/** Where each view button looks from: turn about the vertical, and tilt down from level. */
export const PRESETS: Record<CameraView, { az: number; el: number }> = {
  '3d': { az: 45, el: 30 },
  top: { az: 0, el: 90 },
  front: { az: 0, el: 0 },
  side: { az: 90, el: 0 },
}
export const COLORS = { beam: '#2563eb', column: '#c2410c', added: '#15803d', selected: '#7c3aed', hover: '#db2777', dim: '#334155', bottom: '#15803d', top: '#b91c1c' }
const PICK_PX = 7 // a click this close to an element picks it

export type Vec = [number, number, number]
export type Cam = { az: number; el: number }
export type Viewport = { zoom: number; pan: [number, number] }
export interface Placed {
  e: WireframeElement
  points: Vec[]
}
export interface Frame {
  centre: Vec
  reach: number
}

export function frameOf(placed: Placed[]): Frame | null {
  const all = placed.flatMap((p) => p.points)
  if (!all.length) return null
  const lo = [0, 1, 2].map((i) => Math.min(...all.map((p) => p[i]!)))
  const hi = [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i]!)))
  return {
    centre: lo.map((v, i) => (v + hi[i]!) / 2) as Vec,
    reach: Math.hypot(hi[0]! - lo[0]!, hi[1]! - lo[1]!, hi[2]! - lo[2]!) || 1,
  }
}

/** Model point (mm) → screen point (CSS px) in a view ``width`` × ``height``: orthographic,
 *  turned ``az`` about the vertical and tilted ``el`` down; zoom and pan on top. */
export function projector(cam: Cam, frame: Frame, vp: Viewport, width: number, height: number) {
  const [ca, sa, ce, se] = [Math.cos(cam.az * DEG), Math.sin(cam.az * DEG), Math.cos(cam.el * DEG), Math.sin(cam.el * DEG)]
  const s = ((Math.min(width, height) - 2 * PAD) / frame.reach) * vp.zoom
  return ([x, y, z]: Vec): [number, number] => {
    const [dx, dy, dz] = [x - frame.centre[0], y - frame.centre[1], z - frame.centre[2]]
    const across = dx * ca - dy * sa
    const up = dz * ce + (dx * sa + dy * ca) * se
    return [width / 2 + across * s + vp.pan[0], height / 2 - up * s + vp.pan[1]]
  }
}

function segmentGap(px: number, py: number, a: [number, number], b: [number, number]): number {
  const [vx, vy] = [b[0] - a[0], b[1] - a[1]]
  const len = vx * vx + vy * vy
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * vx + (py - a[1]) * vy) / len)) : 0
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy))
}

/** The element drawn nearest a screen point, within ``PICK_PX``. */
export function nearestElement(placed: Placed[], project: (p: Vec) => [number, number], x: number, y: number): string | null {
  let best: { id: string; gap: number } | null = null
  for (const { e, points } of placed) {
    const screen = points.map(project)
    for (let i = 0; i < screen.length - 1; i++) {
      const gap = segmentGap(x, y, screen[i]!, screen[i + 1]!)
      if (gap <= PICK_PX && (!best || gap < best.gap)) best = { id: e.id, gap }
    }
  }
  return best?.id ?? null
}


import type { WireframeGrid } from '../../api/types'

/** The model's extent in plan (mm): where a grid line with no extent of its own is drawn. */
export interface PlanBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface GridSegment {
  label: string
  from: [number, number]
  to: [number, number]
}

/** Each grid line as a segment in plan (mm), run a little past the model (``margin`` of its
 *  size) so its label sits clear of the members, as on a drawing. */
export function gridSegments(grids: WireframeGrid[], box: PlanBox, margin = 0.06): GridSegment[] {
  const reach = Math.max(box.maxX - box.minX, box.maxY - box.minY, 1) * margin
  return grids.map((g) => {
    const at = Number(g.position_mm)
    const start = g.start_mm != null ? Number(g.start_mm) : null
    const end = g.end_mm != null ? Number(g.end_mm) : null
    if (g.direction === 'x') {
      const [a, b] = [Math.min(start ?? box.minY, box.minY), Math.max(end ?? box.maxY, box.maxY)]
      return { label: g.label, from: [at, a - reach], to: [at, b + reach] }
    }
    if (g.direction === 'y') {
      const [a, b] = [Math.min(start ?? box.minX, box.minX), Math.max(end ?? box.maxX, box.maxX)]
      return { label: g.label, from: [a - reach, at], to: [b + reach, at] }
    }
    // Angled: ``at`` is its distance from the origin along the normal, start/end along it.
    const angle = ((g.angle_deg ?? 0) * Math.PI) / 180
    const [ux, uy] = [Math.cos(angle), Math.sin(angle)]
    const [nx, ny] = [-uy, ux]
    const corners = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.minX, box.maxY],
      [box.maxX, box.maxY],
    ].map(([x, y]) => x! * ux + y! * uy)
    const a = Math.min(start ?? Math.min(...corners), Math.min(...corners)) - reach
    const b = Math.max(end ?? Math.max(...corners), Math.max(...corners)) + reach
    return { label: g.label, from: [nx * at + ux * a, ny * at + uy * a], to: [nx * at + ux * b, ny * at + uy * b] }
  })
}

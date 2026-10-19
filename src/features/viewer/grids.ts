import type { GridPoint } from '../../api/types'

/** How close (PDF points) a click must be to a grid intersection to snap onto it. */
export const SNAP_PT = 24

/** The grid intersection nearest to ``point``, if one is within ``within`` PDF points. */
export function nearestGridPoint(points: GridPoint[] | null | undefined, point: [number, number], within = SNAP_PT): GridPoint | null {
  let best: GridPoint | null = null
  let bestDistance = within
  for (const p of points ?? []) {
    const distance = Math.hypot(p.x - point[0], p.y - point[1])
    if (distance <= bestDistance) {
      best = p
      bestDistance = distance
    }
  }
  return best
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

/** Grid intersections in a natural order (A/1, A/2, A/10, B/1 …), one per label. */
export function sortedGridPoints(points: GridPoint[] | null | undefined): GridPoint[] {
  const seen = new Set<string>()
  return [...(points ?? [])].sort((a, b) => collator.compare(a.label, b.label)).filter((p) => (seen.has(p.label) ? false : (seen.add(p.label), true)))
}

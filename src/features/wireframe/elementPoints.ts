import type { WireframeElement } from '../../api/types'

/** The points an element is drawn through: its curved path when it has one (a curved member,
 *  OD-33), otherwise its two ends. Null when it isn't placed. */
export function elementPoints(e: WireframeElement): [number, number, number][] | null {
  if (!e.start || !e.end) return null
  const path = (e.details as { path?: string[][] } | null)?.path
  const raw = path && path.length > 2 ? path : [e.start, e.end]
  return raw.map((p) => p.map(Number) as [number, number, number])
}

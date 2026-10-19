import type { PageViewport } from './pdf'

const PAD = 3 // px around the label box so thin text is easy to hit

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** PDF points (unrotated page space, y up) → CSS pixels on the rendered page. */
export function toViewportRect(viewport: PageViewport, bbox: number[]): Rect {
  // Two opposite corners (works for rotated pages too; PDF.js 6 has no rectangle helper).
  const [x1, y1] = viewport.convertToViewportPoint(bbox[0]!, bbox[1]!) as [number, number]
  const [x2, y2] = viewport.convertToViewportPoint(bbox[2]!, bbox[3]!) as [number, number]
  const x = Math.min(x1!, x2!)
  const y = Math.min(y1!, y2!)
  return {
    x: x - PAD,
    y: y - PAD,
    width: Math.abs(x2! - x1!) + 2 * PAD,
    height: Math.abs(y2! - y1!) + 2 * PAD,
  }
}

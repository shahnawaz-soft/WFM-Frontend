import type { WireframeGrid } from '../../api/types'
import { signedFeetInches } from '../abm/format'

/** Placing a member by grid and offset, as the old Wireframer did ("C/4, 2'-6" right"): the
 *  point is the grid line's position plus the offset, written in feet-inches for the fields. */

export interface GridOffset {
  label: string
  offset: string
}

const LENGTH = /^(-)?\s*(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*")?$/

/** Millimetres of a feet-inches length (2'-6", -6", 1'-0 1/2", 10'); blank or 0 is 0; null when
 *  it isn't a length. */
export function parseFeetInches(text: string): number | null {
  const value = text.trim()
  if (value === '' || value === '0') return 0
  const m = LENGTH.exec(value)
  if (!m || (m[2] === undefined && m[3] === undefined)) return null
  if (m[5] !== undefined && Number(m[5]) === 0) return null
  const inches = Number(m[2] ?? 0) * 12 + Number(m[3] ?? 0) + (m[4] ? Number(m[4]) / Number(m[5]) : 0)
  return (m[1] ? -1 : 1) * inches * 25.4
}

/** The project's straight grid lines of one direction ("x": lines across X, at an X position),
 *  in order. Diagonal lines have no single position to measure from. */
export function straightGrids(grids: WireframeGrid[], direction: 'x' | 'y'): WireframeGrid[] {
  return grids
    .filter((g) => g.direction === direction && (g.angle_deg == null || g.angle_deg === 0))
    .sort((a, b) => Number(a.position_mm) - Number(b.position_mm))
}

/** [x, y] in feet-inches for a grid crossing plus offsets, or what is missing. */
export function gridPoint(grids: WireframeGrid[], x: GridOffset, y: GridOffset): [string, string] | string {
  const out: [string, string] = ['', '']
  for (const [i, axis, pick] of [
    [0, 'X', x],
    [1, 'Y', y],
  ] as const) {
    const line = straightGrids(grids, axis === 'X' ? 'x' : 'y').find((g) => g.label === pick.label)
    if (!line) return `Pick an ${axis} grid.`
    const offset = parseFeetInches(pick.offset)
    if (offset === null) return `${axis} offset: type a length like 2'-6".`
    out[i] = signedFeetInches(String(Number(line.position_mm) + offset)) ?? ''
  }
  return out
}

/** The grid nearest a coordinate (mm) and the offset from it, in feet-inches ("0" on it). */
export function nearestGrid(grids: WireframeGrid[], direction: 'x' | 'y', mm: string | null): GridOffset {
  const lines = straightGrids(grids, direction)
  if (!lines.length || mm == null) return { label: '', offset: '0' }
  const at = Number(mm)
  const near = lines.reduce((a, b) => (Math.abs(Number(b.position_mm) - at) < Math.abs(Number(a.position_mm) - at) ? b : a))
  const gap = at - Number(near.position_mm)
  return { label: near.label, offset: Math.abs(gap) < 12.7 ? '0' : signedFeetInches(String(gap)) ?? '0' }
}

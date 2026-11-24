import type { GridSegment } from './gridGeometry'

/** A grid line's name placed in the plan (SVG units: y down). */
export interface GridLabel {
  text: string
  x: number
  y: number
  anchor: 'middle' | 'end'
  /** 0 next to the line's end, then further out: labels that would touch are staggered. */
  row: number
}

const widthOf = (text: string, size: number) => size * (0.62 * text.length + 0.6)

/** Each grid line's name at its end, as on a drawing: lines running up the sheet named under
 *  them, lines across named on the left. Names that would touch their neighbour's go one row
 *  further out (PTC's Y32.A and Y22.A, 26 and 27, a few inches apart), and a name repeated at
 *  one place is shown once. ``size``: the text height, in plan units; ``maxRows``: names that
 *  would need more rows are left out (shown when their line is pointed at). */
export function placeGridLabels(segments: GridSegment[], size: number, maxRows = Infinity): GridLabel[] {
  const up: { text: string; at: number; end: number }[] = []
  const across: { text: string; at: number; end: number }[] = []
  const other: GridLabel[] = []
  for (const s of segments) {
    if (s.from[0] === s.to[0]) up.push({ text: s.label, at: s.from[0], end: -Math.min(s.from[1], s.to[1]) })
    else if (s.from[1] === s.to[1]) across.push({ text: s.label, at: -s.from[1], end: Math.min(s.from[0], s.to[0]) })
    else other.push({ text: s.label, x: s.from[0], y: -s.from[1], anchor: 'middle', row: 0 })
  }

  const labels: GridLabel[] = []
  // Under the lines running up the sheet: left to right, a row's next name clear of its last.
  const rowEnds: number[] = []
  let last: { text: string; at: number } | null = null
  for (const l of [...up].sort((a, b) => a.at - b.at)) {
    const half = widthOf(l.text, size) / 2
    if (last && last.text === l.text && l.at - last.at < half * 2) continue
    last = l
    let row = rowEnds.findIndex((end) => l.at - half > end)
    if (row < 0) row = rowEnds.length
    if (row >= maxRows) continue // no room: named on hover
    rowEnds[row] = l.at + half
    labels.push({ text: l.text, x: l.at, y: l.end + size * (1.3 + 1.3 * row), anchor: 'middle', row })
  }
  // Left of the lines across: top to bottom, a column's next name clear of its last.
  const widest = Math.max(0, ...across.map((l) => widthOf(l.text, size)))
  const columnEnds: number[] = []
  let previous: { text: string; at: number } | null = null
  for (const l of [...across].sort((a, b) => a.at - b.at)) {
    if (previous && previous.text === l.text && l.at - previous.at < size * 1.2) continue
    previous = l
    let row = columnEnds.findIndex((end) => l.at - size * 0.6 > end)
    if (row < 0) row = columnEnds.length
    if (row >= maxRows) continue // no room: named on hover
    columnEnds[row] = l.at + size * 0.6
    labels.push({ text: l.text, x: l.end - size * 0.5 - row * (widest + size * 0.5), y: l.at + size * 0.35, anchor: 'end', row })
  }
  return [...labels, ...other]
}

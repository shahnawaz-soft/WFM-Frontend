import type { SchedulerRow } from '../../api/types'

/** Pieces this close on plan (mm) are one stack: a column drawn on two plans lands within a few
 *  inches of itself (6", as the plans' crossings agree in ``registration``). */
const SAME_PLACE_MM = 150
const CELL_MM = SAME_PLACE_MM * 2

/** A column stack: the old Wireframer's "column group", every piece at one plan position from
 *  its lowest bottom to its highest top. A value the pieces don't share is null ("mixed"). */
export interface ColumnGroup {
  key: string
  rows: SchedulerRow[]
  grid: string
  mark: string | null
  designation: string | null
  column_type: SchedulerRow['column_type'] | null
  rotation: SchedulerRow['rotation'] | null
  bottom_mm: string | null
  top_mm: string | null
  height_mm: string | null
  pages: number[]
}

const shared = <T,>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0]! : null)

const mm = (v: string | null) => (v === null ? null : Number(v))

/** The columns as stacks, in the order their first piece comes in the schedule; the pieces of a
 *  stack bottom to top. A column not placed on plan stands alone. */
export function groupColumns(rows: SchedulerRow[]): ColumnGroup[] {
  const stacks: { x: number; y: number; rows: SchedulerRow[] }[] = []
  const alone: { index: number; row: SchedulerRow }[] = []
  const cells = new Map<string, number[]>()
  const order: { stack?: number; alone?: number }[] = []
  for (const row of rows) {
    const x = mm(row.x_mm)
    const y = mm(row.y_mm)
    if (x === null || y === null) {
      order.push({ alone: alone.length })
      alone.push({ index: order.length - 1, row })
      continue
    }
    const cx = Math.floor(x / CELL_MM)
    const cy = Math.floor(y / CELL_MM)
    let found: number | null = null
    for (let dx = -1; dx <= 1 && found === null; dx++) {
      for (let dy = -1; dy <= 1 && found === null; dy++) {
        for (const i of cells.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (Math.hypot(stacks[i]!.x - x, stacks[i]!.y - y) <= SAME_PLACE_MM) {
            found = i
            break
          }
        }
      }
    }
    if (found !== null) {
      stacks[found]!.rows.push(row)
      continue
    }
    const cell = `${cx}:${cy}`
    cells.set(cell, [...(cells.get(cell) ?? []), stacks.length])
    order.push({ stack: stacks.length })
    stacks.push({ x, y, rows: [row] })
  }
  return order.map((o) => (o.stack !== undefined ? group(stacks[o.stack]!.rows) : group([alone[o.alone!]!.row])))
}

function group(pieces: SchedulerRow[]): ColumnGroup {
  const rows = [...pieces].sort((a, b) => (mm(a.bottom_mm) ?? Infinity) - (mm(b.bottom_mm) ?? Infinity))
  const bottoms = rows.map((r) => mm(r.bottom_mm)).filter((v): v is number => v !== null)
  const tops = rows.map((r) => mm(r.top_mm)).filter((v): v is number => v !== null)
  const bottom = bottoms.length ? Math.min(...bottoms) : null
  const top = tops.length ? Math.max(...tops) : null
  const fixed = (v: number | null) => (v === null ? null : v.toFixed(1))
  return {
    key: rows.map((r) => r.id).join('|'),
    rows,
    grid: rows.find((r) => r.grid)?.grid ?? '',
    mark: shared(rows.map((r) => r.mark)),
    designation: shared(rows.map((r) => r.designation)),
    column_type: shared(rows.map((r) => r.column_type)),
    rotation: shared(rows.map((r) => r.rotation)),
    bottom_mm: fixed(bottom),
    top_mm: fixed(top),
    height_mm: bottom !== null && top !== null ? fixed(top - bottom) : null,
    pages: [...new Set(rows.map((r) => r.page_number).filter((p): p is number => p != null))].sort((a, b) => a - b),
  }
}

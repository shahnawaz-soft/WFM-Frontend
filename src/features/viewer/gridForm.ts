import { gridEditsOf } from '../../api/processing'
import type { DrawingPage, GridLine } from '../../api/types'

export type Orientation = 'vertical' | 'horizontal' | 'diagonal'

/** The dialog's values, kept while the person picks a second point for the slope. */
export interface GridForm {
  label: string
  orientation: Orientation
  base: boolean
  /** An existing diagonal group (its slope), or '' for a new slope typed or picked. */
  group: string
  slope: string
  realAngle: string
  reference: string
  distance: string
  direction: '+' | '-'
}

export const BLANK_GRID_FORM: GridForm = {
  label: '',
  orientation: 'vertical',
  base: false,
  group: '',
  slope: '',
  realAngle: '',
  reference: '',
  distance: '',
  direction: '+',
}

// The dialog speaks of the sheet as it is seen. A page stored turned (/Rotate 90 or 270: Revit
// exports, Clwan Up) shows its PDF's vertical lines across, so its grids' orientation, slope and
// +/- side are turned for the dialog and back for the page, which keeps them in PDF terms.

const turned = (rotation: number) => ((rotation % 360) + 360) % 180 !== 0

/** A point in PDF space as seen on the sheet (y up), the page turned clockwise by ``rotation``. */
function seen([x, y]: [number, number], rotation: number): [number, number] {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return [y, -x]
    case 180:
      return [-x, -y]
    case 270:
      return [-y, x]
    default:
      return [x, y]
  }
}

/** Vertical in PDF terms is horizontal as seen on a turned sheet (and the other way round). */
export function seenOrientation(orientation: Orientation, rotation: number): Orientation {
  if (orientation === 'diagonal' || !turned(rotation)) return orientation
  return orientation === 'vertical' ? 'horizontal' : 'vertical'
}

/** A slope in PDF terms as seen on the sheet, or one seen back in PDF terms (the same turn). */
export function seenSlope(slope: number, rotation: number): number {
  return turned(rotation) && slope !== 0 ? Number((-1 / slope).toFixed(6)) : slope
}

/** The +/- side (right / above as seen) in PDF terms, or back: the same flip both ways. */
export function seenDirection(direction: '+' | '-', orientation: Orientation, rotation: number): '+' | '-' {
  const r = ((rotation % 360) + 360) % 360
  const flip = orientation !== 'diagonal' && (r === 180 || (r === 90 && orientation === 'horizontal') || (r === 270 && orientation === 'vertical'))
  return flip ? (direction === '+' ? '-' : '+') : direction
}

/** The slope (rise / run as seen on the sheet) of the line through two picked points (PDF
 *  points); '' if upright as seen. */
export function slopeBetween(a: [number, number], b: [number, number], rotation = 0): string {
  const [ax, ay] = seen(a, rotation)
  const [bx, by] = seen(b, rotation)
  const dx = bx - ax
  return Math.abs(dx) < 1e-9 ? '' : String(Number(((by - ay) / dx).toFixed(6)))
}

export const SLOPE_TOLERANCE = 0.01

/** Rise / run of a straight grid on the sheet (y up); null when vertical. */
export function slopeOf(g: Pick<GridLine, 'x1' | 'y1' | 'x2' | 'y2'>): number | null {
  const dx = g.x2 - g.x1
  return Math.abs(dx) < 1e-9 ? null : Number(((g.y2 - g.y1) / dx).toFixed(6))
}

export const kindOf = (g: GridLine): Orientation =>
  g.orientation === 'vertical' || g.orientation === 'horizontal' ? g.orientation : 'diagonal'

/** The diagonal groups on the page: one per slope, with the grids in it. */
export function slopeGroups(grids: GridLine[]) {
  const groups: { slope: number; labels: string[] }[] = []
  for (const g of grids) {
    if (g.arc || kindOf(g) !== 'diagonal') continue
    const slope = slopeOf(g)
    if (slope === null) continue
    const group = groups.find((x) => Math.abs(x.slope - slope) <= SLOPE_TOLERANCE)
    if (group) group.labels.push(g.label)
    else groups.push({ slope, labels: [g.label] })
  }
  return groups
}

/** What the dialog opens with: a new grid at the point, or the grid being edited (as seen). */
export function initialForm(page: DrawingPage, grids: GridLine[], editing: string | null): GridForm {
  const blank = BLANK_GRID_FORM
  if (!editing) return blank
  const rotation = page.rotation
  const record = gridEditsOf(page.grid_edits).grids.find((r) => r.label === editing)
  if (record) {
    const inches = record.distance_in
    const orientation = seenOrientation(record.orientation, rotation)
    return {
      ...blank,
      label: record.label,
      orientation,
      base: record.base,
      slope: record.slope === null ? '' : String(seenSlope(record.slope, rotation)),
      realAngle: record.real_angle === null ? '' : String(record.real_angle),
      reference: record.reference,
      distance: (record.distance_text || '').replace(/^-/, ''),
      direction: seenDirection(inches !== null && inches < 0 ? '-' : '+', orientation, rotation),
    }
  }
  const drawn = grids.find((g) => g.label === editing)
  if (!drawn) return { ...blank, label: editing }
  const slope = slopeOf(drawn)
  const diagonal = kindOf(drawn) === 'diagonal'
  return {
    ...blank,
    label: drawn.label,
    orientation: seenOrientation(kindOf(drawn), rotation),
    slope: diagonal && slope !== null ? String(seenSlope(slope, rotation)) : '',
  }
}

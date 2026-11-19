/** The detailers' checking colours (19 Nov 2026, user request): each member coloured by the
 *  CLASS that Export CSV and Push to Tekla send for it, in the old Wireframer's colours, on the
 *  page and in the 3D model. */

export type TeklaColour = 'grid' | 'equal' | 'scaled' | 'column' | 'unsent' | 'manual'

export const TEKLA_COLOURS: Record<TeklaColour, { colour: string; label: string; title: string }> = {
  grid: { colour: '#00ff04', label: 'Green: on grids', title: 'Class 3: both ends on grid lines, or on green or orange beams' },
  equal: { colour: '#ffb700', label: 'Orange: equal spaces', title: 'Class 13: one of the beams dividing a bay into equal spaces' },
  scaled: { colour: '#fd3db5', label: 'Pink: scaled', title: 'Class 2: a length that came from scaling the drawing' },
  column: { colour: '#dc2626', label: 'Red: column', title: 'Class 4: every column' },
  unsent: { colour: '#0d00ff', label: 'Blue: not sent', title: 'Not sent to Tekla: no section, or it cannot be placed' },
  manual: { colour: '#bb00ff', label: 'Purple: added or edited', title: 'Added or edited in the 3D model by a person' },
}

const BY_CLASS: Record<string, TeklaColour> = { '3': 'grid', '13': 'equal', '2': 'scaled', '4': 'column' }

export interface TeklaClasses {
  classes: Record<string, string>
  skipped: { id: string }[]
}

/** A member's colour by its id: its class, "unsent" when the export left it out, else null
 *  (not part of the export: rejected, or on another page). */
export function teklaColour(data: TeklaClasses, id: string): TeklaColour | null {
  const cls = data.classes[id]
  if (cls !== undefined) return BY_CLASS[cls] ?? null
  return data.skipped.some((s) => s.id === id) ? 'unsent' : null
}

/** How many of each colour, in the legend's order, leaving out colours not used. */
export function colourCounts(colours: Iterable<TeklaColour | null>): [TeklaColour, number][] {
  const counts = new Map<TeklaColour, number>()
  for (const c of colours) if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
  return (Object.keys(TEKLA_COLOURS) as TeklaColour[]).filter((c) => counts.has(c)).map((c) => [c, counts.get(c)!])
}

/** A 3D element's colour: every column red, as Tekla classes it; an element a person added or
 *  edited purple (the old Wireframer's "manual"); else its source member's class, and "not
 *  sent" when the export doesn't send it. */
export function elementColour(
  data: TeklaClasses,
  element: { element_type: string; provenance: string; source_member: string | null },
): TeklaColour {
  if (element.element_type === 'column') return 'column'
  if (element.provenance !== 'generated') return 'manual'
  return (element.source_member && teklaColour(data, element.source_member)) || 'unsent'
}

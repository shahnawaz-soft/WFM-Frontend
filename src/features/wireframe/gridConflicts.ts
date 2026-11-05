import type { ProjectGrid } from '../../api/types'

/** Two grid lines this close (mm, 6") that run the same way are one line drawn twice. */
const SAME_PLACE_MM = 152.4

export type GridConflictKind = 'same_label' | 'overlapping' | 'plans_disagree'

export interface GridConflict {
  kind: GridConflictKind
  grids: ProjectGrid[]
}

const angle = (g: ProjectGrid) => g.angle_deg ?? 0

/** What a person should look at in the grid table, worked out from the table alone: a label
 *  used twice, two lines in one place under different labels, and lines the plans place in
 *  different places (``disagrees``). Hidden lines are left out. */
export function gridConflicts(rows: ProjectGrid[]): GridConflict[] {
  const shown = rows.filter((g) => !g.hidden)
  const found: GridConflict[] = []
  const byLabel = new Map<string, ProjectGrid[]>()
  for (const g of shown) byLabel.set(g.label.toUpperCase(), [...(byLabel.get(g.label.toUpperCase()) ?? []), g])
  for (const same of byLabel.values()) if (same.length > 1) found.push({ kind: 'same_label', grids: same })
  for (const direction of ['x', 'y'] as const) {
    const line = shown.filter((g) => g.direction === direction).sort((a, b) => Number(a.position_mm) - Number(b.position_mm))
    line.forEach((g, i) => {
      const next = line[i + 1]
      if (
        next &&
        next.label.toUpperCase() !== g.label.toUpperCase() &&
        angle(next) === angle(g) &&
        Math.abs(Number(next.position_mm) - Number(g.position_mm)) < SAME_PLACE_MM
      )
        found.push({ kind: 'overlapping', grids: [g, next] })
    })
  }
  for (const g of shown) if (g.disagrees) found.push({ kind: 'plans_disagree', grids: [g] })
  return found
}

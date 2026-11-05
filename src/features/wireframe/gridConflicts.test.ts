import { describe, expect, it } from 'vitest'

import type { ProjectGrid } from '../../api/types'
import { gridConflicts } from './gridConflicts'

const grid = (id: string, label: string, direction: 'x' | 'y', mm: number, extra: Partial<ProjectGrid> = {}): ProjectGrid =>
  ({
    id,
    label,
    direction,
    position_mm: String(mm),
    position_display: '',
    angle_deg: null,
    start_mm: null,
    end_mm: null,
    source: 'found',
    plans: 2,
    plans_agreeing: 2,
    spread_mm: null,
    disagrees: false,
    locked: false,
    hidden: false,
    ...extra,
  }) as ProjectGrid

describe('Grid conflicts', () => {
  it('finds a label used twice, lines on top of each other, and plans that disagree', () => {
    const rows = [
      grid('1', 'A', 'x', 0),
      grid('2', 'A', 'x', 9144),
      grid('3', 'B', 'y', 0),
      grid('4', 'B.1', 'y', 76.2), // 3" from B: one line drawn twice
      grid('5', 'C', 'y', 6096, { disagrees: true, spread_mm: '304.8', plans_agreeing: 1 }),
      grid('6', 'D', 'y', 6200, { hidden: true }), // hidden: not shown, not a conflict
    ]
    const found = gridConflicts(rows)
    expect(found.map((c) => [c.kind, c.grids.map((g) => g.id)])).toEqual([
      ['same_label', ['1', '2']],
      ['overlapping', ['3', '4']],
      ['plans_disagree', ['5']],
    ])
  })

  it('finds nothing in a clean table', () => {
    expect(gridConflicts([grid('1', 'A', 'x', 0), grid('2', 'B', 'x', 9144), grid('3', '1', 'y', 0)])).toEqual([])
  })
})

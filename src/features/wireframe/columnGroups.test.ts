import { describe, expect, it } from 'vitest'

import type { SchedulerRow } from '../../api/types'
import { groupColumns } from './columnGroups'

const piece = (id: string, x: string | null, y: string | null, bottom: string, top: string, extra: Partial<SchedulerRow> = {}) =>
  ({
    id,
    grid: 'A/1',
    mark: 'C1',
    designation: 'W14X99',
    column_type: 'column',
    rotation: 'B',
    x_mm: x,
    y_mm: y,
    bottom_mm: bottom,
    top_mm: top,
    page_number: 1,
    ...extra,
  }) as unknown as SchedulerRow

describe('column groups (the old Wireframer: one row per column stack)', () => {
  it('stacks the pieces at one plan position, bottom to top', () => {
    const groups = groupColumns([
      piece('upper', '1000.0', '2000.0', '6096.0', '9144.0', { page_number: 12 }),
      piece('lower', '1000.0', '2000.0', '0.0', '6096.0', { page_number: 2 }),
      piece('other', '7096.0', '2000.0', '0.0', '6096.0', { grid: 'A/2' }),
    ])
    expect(groups.map((g) => g.rows.map((r) => r.id))).toEqual([['lower', 'upper'], ['other']])
    const [stack] = groups
    expect(stack).toMatchObject({ grid: 'A/1', bottom_mm: '0.0', top_mm: '9144.0', height_mm: '9144.0', pages: [2, 12] })
  })

  it('says when the pieces of a stack differ', () => {
    const [stack] = groupColumns([
      piece('a', '0.0', '0.0', '0.0', '3000.0'),
      piece('b', '0.0', '0.0', '3000.0', '6000.0', { designation: 'W14X68', rotation: 'T' }),
    ])
    expect(stack).toMatchObject({ designation: null, rotation: null, column_type: 'column' })
  })

  it('keeps a column that is not placed on its own', () => {
    const groups = groupColumns([piece('a', null, null, '0.0', '3000.0'), piece('b', null, null, '0.0', '3000.0')])
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1])
  })

  it('takes pieces a few inches apart as one stack', () => {
    const groups = groupColumns([piece('a', '1000.0', '1000.0', '0.0', '3000.0'), piece('b', '1060.0', '990.0', '3000.0', '6000.0')])
    expect(groups).toHaveLength(1)
  })
})

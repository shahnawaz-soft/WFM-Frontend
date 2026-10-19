import { describe, expect, it } from 'vitest'

import { nearestGridPoint, sortedGridPoints } from './grids'

const points = [
  { label: 'B/10', x: 900, y: 500 },
  { label: 'A/2', x: 300, y: 100 },
  { label: 'B/2', x: 300, y: 500 },
  { label: 'A/1', x: 100, y: 100 },
  { label: 'A/1', x: 2100, y: 100 }, // the same intersection in a second view of the sheet
]

describe('grid intersections', () => {
  it('snaps to the nearest one within reach', () => {
    expect(nearestGridPoint(points, [290, 110])?.label).toBe('A/2')
    expect(nearestGridPoint(points, [200, 300])).toBeNull()
    expect(nearestGridPoint(null, [0, 0])).toBeNull()
  })

  it('lists each label once, in natural order', () => {
    expect(sortedGridPoints(points).map((p) => p.label)).toEqual(['A/1', 'A/2', 'B/2', 'B/10'])
  })
})

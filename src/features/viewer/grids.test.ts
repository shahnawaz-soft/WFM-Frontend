import { describe, expect, it } from 'vitest'

import type { GridLine } from '../../api/types'
import { gridsBox, nearestGridPoint, sortedGridPoints } from './grids'

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

const line = (x1: number, y1: number, x2: number, y2: number, extra: Partial<GridLine> = {}) =>
  ({ label: 'A', x1, y1, x2, y2, bubbles: [], secondary: false, ...extra }) as unknown as GridLine

describe('the plan box (Fit plan)', () => {
  it('spans the grid lines and their bubbles, with a margin', () => {
    const grids = [line(100, 200, 100, 600, { bubbles: [[100, 620, 10]] }), line(80, 300, 500, 300)]
    expect(gridsBox(grids)).toEqual([80 - 20, 200 - 20, 500 + 20, 630 + 20])
  })

  it('leaves out lines that only repeat a grid elsewhere on the sheet (key plan, detail)', () => {
    const grids = [line(100, 200, 100, 600), line(2000, 10, 2100, 20, { secondary: true })]
    expect(gridsBox(grids)).toEqual([80, 180, 120, 620])
  })

  it('is none without grids', () => {
    expect(gridsBox([])).toBeNull()
    expect(gridsBox(null)).toBeNull()
  })
})

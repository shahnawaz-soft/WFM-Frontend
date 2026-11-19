import { describe, expect, it } from 'vitest'

import type { WireframeGrid } from '../../api/types'
import { gridPoint, nearestGrid, parseFeetInches, straightGrids } from './gridPosition'

const grid = (label: string, direction: 'x' | 'y', position_mm: string, angle_deg: number | null = null): WireframeGrid => ({
  label,
  direction,
  position_mm,
  angle_deg,
  start_mm: null,
  end_mm: null,
})

const GRIDS = [
  grid('A', 'x', '0.0'),
  grid('B', 'x', '9144.0'), // 30'-0"
  grid('1', 'y', '0.0'),
  grid('2', 'y', '7620.0'), // 25'-0"
  grid('D1', 'x', '100.0', 30), // diagonal: not a straight line to measure from
]

describe('parseFeetInches', () => {
  it.each([
    ["2'-6\"", 762],
    ["2' 6\"", 762],
    ["-2'-6\"", -762],
    ["6\"", 152.4],
    ["1'-0 1/2\"", 317.5],
    ["10'", 3048],
    ['0', 0],
    ['', 0],
  ])('%s is %s mm', (text, mm) => {
    expect(parseFeetInches(text)).toBeCloseTo(mm, 1)
  })

  it.each(['abc', "2'-x\"", '1/0"'])('%s is not a length', (text) => {
    expect(parseFeetInches(text)).toBeNull()
  })
})

describe('grid positions', () => {
  it('lists the straight grids of a direction in order, diagonals left out', () => {
    expect(straightGrids(GRIDS, 'x').map((g) => g.label)).toEqual(['A', 'B'])
  })

  it('a grid crossing plus offsets is a point, in feet-inches as the fields take it', () => {
    expect(gridPoint(GRIDS, { label: 'B', offset: "-2'-6\"" }, { label: '2', offset: '0' })).toEqual(["27'-6\"", "25'-0\""])
  })

  it('an unknown grid or offset is said, not guessed', () => {
    expect(gridPoint(GRIDS, { label: 'Z', offset: '0' }, { label: '1', offset: '0' })).toBe('Pick an X grid.')
    expect(gridPoint(GRIDS, { label: 'A', offset: 'abc' }, { label: '1', offset: '0' })).toBe('X offset: type a length like 2\'-6".')
  })

  it('a point is named by its nearest grid and the offset from it', () => {
    expect(nearestGrid(GRIDS, 'x', '8382.0')).toEqual({ label: 'B', offset: "-2'-6\"" })
    expect(nearestGrid(GRIDS, 'y', '0.0')).toEqual({ label: '1', offset: '0' })
    expect(nearestGrid([], 'x', '100')).toEqual({ label: '', offset: '0' })
  })
})

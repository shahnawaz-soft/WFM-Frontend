import { describe, expect, it } from 'vitest'

import type { GridSegment } from './gridGeometry'
import { placeGridLabels } from './gridLabels'

const v = (label: string, x: number): GridSegment => ({ label, from: [x, 0], to: [x, 1000] })
const h = (label: string, y: number): GridSegment => ({ label, from: [0, y], to: [1000, y] })

describe('grid labels in the plan (PTC: 26 and 27 a few inches apart)', () => {
  it('puts labels of lines far apart on one row, under their lines', () => {
    const labels = placeGridLabels([v('1', 0), v('2', 500)], 10)
    expect(labels.map((l) => [l.text, l.x, l.row])).toEqual([
      ['1', 0, 0],
      ['2', 500, 0],
    ])
    expect(labels[0]!.y).toBeGreaterThan(0) // below the line's bottom end (svg y down)
  })

  it('moves a label that would touch its neighbour to the next row', () => {
    const labels = placeGridLabels([v('26', 0), v('27', 8), v('28', 16)], 10)
    expect(labels.map((l) => l.row)).toEqual([0, 1, 2])
    expect(new Set(labels.map((l) => l.y)).size).toBe(3)
  })

  it('staggers labels of lines across the sheet to the left', () => {
    const labels = placeGridLabels([h('Y32.A', 0), h('Y22.A', 4)], 10)
    expect(labels.map((l) => l.row)).toEqual([0, 1])
    expect(labels[1]!.x).toBeLessThan(labels[0]!.x)
    expect(labels.every((l) => l.anchor === 'end')).toBe(true)
  })

  it('shows a label repeated at one place once', () => {
    expect(placeGridLabels([v('A', 0), v('A', 2)], 10)).toHaveLength(1)
  })

  it('leaves out names with no room in the rows allowed', () => {
    const labels = placeGridLabels([v('26', 0), v('27', 8), v('28', 16)], 10, 1)
    expect(labels.map((l) => l.text)).toEqual(['26'])
  })
})

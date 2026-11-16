import { describe, expect, it } from 'vitest'

import type { DrawingPage, GridLine } from '../../api/types'
import { initialForm, seenDirection, seenOrientation, seenSlope, slopeBetween } from './gridForm'

const grid = (label: string, x1: number, y1: number, x2: number, y2: number, orientation: string) =>
  ({ label, x1, y1, x2, y2, orientation, angle: 0, drawn: true, bubbles: [] }) as unknown as GridLine
const page = (rotation: number, grid_edits = {}) => ({ rotation, grid_edits }) as unknown as DrawingPage

describe('grid dialog on a sheet stored turned (Clwan Up: /Rotate 90)', () => {
  it('shows a PDF-horizontal grid as the vertical line seen on the sheet', () => {
    const l4 = grid('L4', 100, 700, 1400, 700, 'horizontal')
    expect(initialForm(page(90), [l4], 'L4').orientation).toBe('vertical')
    expect(initialForm(page(0), [l4], 'L4').orientation).toBe('horizontal')
  })

  it('turns orientation, slope and side back to PDF terms the same way', () => {
    expect(seenOrientation('vertical', 270)).toBe('horizontal')
    expect(seenOrientation('diagonal', 90)).toBe('diagonal')
    expect(seenSlope(seenSlope(0.5, 90), 90)).toBe(0.5)
    expect(seenSlope(0.5, 90)).toBe(-2)
    // seen horizontal on a page turned 90: "above" is towards PDF x = 0, its "-" side
    expect(seenDirection('+', 'horizontal', 90)).toBe('-')
    expect(seenDirection('+', 'vertical', 90)).toBe('+')
    expect(seenDirection('+', 'vertical', 0)).toBe('+')
  })

  it('reads a picked slope as seen on the sheet', () => {
    // two PDF points along x (PDF-horizontal): upright as seen on a page turned 90
    expect(slopeBetween([0, 0], [10, 0], 90)).toBe('')
    expect(slopeBetween([0, 0], [10, 5], 0)).toBe('0.5')
    expect(slopeBetween([0, 0], [10, 5], 90)).toBe('-2')
  })
})

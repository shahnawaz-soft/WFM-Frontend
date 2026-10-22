import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { WireframeElement } from '../../api/types'
import { IsometricPreview } from './IsometricPreview'
import { frameOf, nearestElement, PRESETS, projector, type Placed } from './isoProjection'

const column = {
  id: 'c1',
  element_type: 'column',
  designation: 'W14X99',
  start: ['0.0', '0.0', '0.0'],
  end: ['0.0', '0.0', '4267.2'],
  details: {},
} as unknown as WireframeElement
const beam = { ...column, id: 'b1', element_type: 'beam', start: ['0.0', '0.0', '4267.2'], end: ['6000.0', '0.0', '4267.2'] } as unknown as WireframeElement
const placed: Placed[] = [column, beam].map((e) => ({ e, points: [e.start, e.end].map((p) => p!.map(Number)) as Placed['points'] }))
const frame = frameOf(placed)!
const still = { zoom: 1, pan: [0, 0] as [number, number] }

describe('Simple view without WebGL', () => {
  it('is drawn on a canvas, with a Rotate / Move switch', async () => {
    render(<IsometricPreview elements={[column, beam]} selectedId={null} />)
    expect(screen.getByRole('img', { name: 'Wireframe view: 1 beams and 1 columns placed' })).toBeInTheDocument()
    const move = screen.getByRole('button', { name: 'Move' })
    await userEvent.click(move)
    expect(move).toHaveAttribute('aria-pressed', 'true')
  })

  it('flat views drag to move; the 3D view drags to rotate', () => {
    render(<IsometricPreview elements={[column, beam]} selectedId={null} view="top" />)
    expect(screen.getByRole('button', { name: 'Move' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('the Top view looks straight down: a column is a point', () => {
    const project = projector(PRESETS.top, frame, still, 960, 520)
    const [a, b] = [project([0, 0, 0]), project([0, 0, 4267.2])]
    expect(a[0]).toBeCloseTo(b[0])
    expect(a[1]).toBeCloseTo(b[1])
  })

  it('the Front view shows heights upright', () => {
    const project = projector(PRESETS.front, frame, still, 960, 520)
    const [bottom, top] = [project([0, 0, 0]), project([0, 0, 4267.2])]
    expect(bottom[0]).toBeCloseTo(top[0])
    expect(top[1]).toBeLessThan(bottom[1])
  })

  it('zoom and pan move the drawing; a click picks the member under it', () => {
    const project = projector(PRESETS.front, frame, { zoom: 2, pan: [50, 0] }, 960, 520)
    const [x, y] = project([3000, 0, 4267.2]) // the middle of the beam
    expect(nearestElement(placed, project, x, y + 3)).toBe('b1')
    const [cx, cy] = project([0, 0, 2000]) // up the column
    expect(nearestElement(placed, project, cx + 2, cy)).toBe('c1')
    expect(nearestElement(placed, project, x, y + 60)).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import type { WireframeGrid } from '../../api/types'
import { gridSegments } from './gridGeometry'

const grid = (extra: Partial<WireframeGrid>) =>
  ({ label: 'A', direction: 'x', position_mm: '0.0', angle_deg: null, start_mm: null, end_mm: null, ...extra }) as WireframeGrid
const box = { minX: 0, minY: 0, maxX: 10_000, maxY: 5_000 }

describe('grid segments', () => {
  it('draws an x grid up the model, a little past it', () => {
    expect(gridSegments([grid({ label: '2', position_mm: '9144.0' })], box)).toEqual([
      { label: '2', from: [9144, -600], to: [9144, 5600] },
    ])
  })

  it('draws a y grid across, as far as the plans draw it when that is further', () => {
    const [segment] = gridSegments([grid({ direction: 'y', position_mm: '3000.0', start_mm: '-2000.0', end_mm: '8000.0' })], box)
    expect(segment).toEqual({ label: 'A', from: [-2600, 3000], to: [10_600, 3000] })
  })

  it('draws an angled grid along its angle, at its distance from the origin', () => {
    const [segment] = gridSegments([grid({ direction: 'angled', angle_deg: 90, position_mm: '-1000.0' })], box)
    // 90°: it runs along y; its normal points to -x, so -1000 mm along it is x = 1000.
    expect(segment!.from[0]).toBeCloseTo(1000)
    expect(segment!.to[0]).toBeCloseTo(1000)
    expect(segment!.to[1] - segment!.from[1]).toBeCloseTo(5000 + 2 * 600)
  })
})

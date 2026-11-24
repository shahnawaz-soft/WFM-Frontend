import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ColumnVisual } from './ColumnVisual'

describe('Column visual', () => {
  it('names levels at one height on one line (PTC: catwalk and cooler TOS both at 20\'-0")', () => {
    render(
      <ColumnVisual
        groups={[]}
        selection={new Set()}
        onPick={() => {}}
        levels={[
          { label: 'FOUNDATION', elevation_mm: '0.0', elevation_display: '0\'-0"' },
          { label: 'CATWALK', elevation_mm: '6096.0', elevation_display: '20\'-0"' },
          { label: 'COOLER TOS', elevation_mm: '6096.0', elevation_display: '20\'-0"' },
        ]}
      />,
    )
    const chart = screen.getByRole('img', { name: 'Column groups by elevation' })
    const labels = [...chart.querySelectorAll('.col-visual__level text')].map((t) => t.textContent)
    expect(labels).toEqual(['FOUNDATION 0\'-0"', 'CATWALK / COOLER TOS 20\'-0"'])
  })
})

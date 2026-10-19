import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AbmEntry } from '../../api/types'
import { AbmTable } from './AbmTable'

function entry(id: string, values: Partial<AbmEntry>) {
  return {
    id,
    designation: 'W24X55',
    mark: '',
    piece_mark: '',
    studs: null,
    studs_text: '',
    camber_mm: null,
    camber_display: '',
    length_mm: '9144.0',
    length_display: "30'-0\"",
    quantity: 1,
    page_number: 12,
    drawing_set: { id: 'd', original_filename: 'Structures.pdf' },
    review_status: 'accepted',
    source: 'detected',
    confidence: 0.75,
    warnings: [],
    origin: 'automated',
    is_corrected: false,
    low_confidence: false,
    weight: null,
    section: null,
    match_status: 'matched',
    member_type: '',
    profile: 'W',
    ...values,
  } as unknown as AbmEntry
}

function rows(entries: AbmEntry[]) {
  render(
    <AbmTable
      entries={entries}
      firstNumber={1}
      selectedId={null}
      hoveredId={null}
      ordering="page"
      onSort={vi.fn()}
      onSelect={vi.fn()}
      onHover={vi.fn()}
    />,
  )
  return screen.getAllByRole('row').slice(1)
}

describe('ABM marks, studs and camber', () => {
  it('shows a typed mark, else the preliminary one, with studs and camber as printed', () => {
    const [typed, proposed, segmented] = rows([
      entry('1', { mark: '2B14', piece_mark: 'B3', studs: 44, studs_text: '44', camber_display: '1 1/2"' }),
      entry('2', { piece_mark: 'B3', studs: 44, studs_text: '44', camber_display: '1 1/2"' }),
      entry('3', { designation: 'W27X146', piece_mark: 'B7', studs_text: '36, 4, 4, 4, 40' }),
    ])
    expect(typed).toHaveTextContent(/2B14/)
    expect(within(typed!).queryByText(/preliminary/)).toBeNull()
    expect(proposed).toHaveTextContent('B3 (preliminary, from Steelo)')
    expect(proposed).toHaveTextContent('44')
    expect(proposed).toHaveTextContent('1 1/2"')
    expect(within(segmented!).getByText('36, 4, 4, 4, 40')).toHaveAttribute('title', 'Studs by segment, as printed')
  })
})

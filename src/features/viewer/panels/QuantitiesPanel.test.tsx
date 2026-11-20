import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { ExtractedMember } from '../../../api/types'
import { QuantitiesPanel } from './QuantitiesPanel'

const member = (id: string, designation: string, extra: Partial<ExtractedMember> = {}) =>
  ({
    id,
    designation,
    member_type: 'beam',
    length_mm: 3048,
    length_display: "10'-0\"",
    review_status: 'unreviewed',
    is_corrected: false,
    origin: 'extracted',
    warnings: [],
    low_confidence: false,
    label_bbox: [0, 0, 1, 1],
    geometry: [],
    ...extra,
  }) as unknown as ExtractedMember

// Three alike (as on PTC p1: 66 × "W14X132 · From levels · To review"), one different.
const MEMBERS = [member('a', 'W14X132'), member('b', 'W12X26'), member('c', 'W14X132'), member('d', 'W14X132')]

function panel(selectedId: string | null = null) {
  const props = { members: MEMBERS, loading: false, hoveredId: null, onSelect: () => {}, onHover: () => {} }
  const view = render(<QuantitiesPanel {...props} selectedId={selectedId} />)
  return { ...view, rerender: (id: string | null) => view.rerender(<QuantitiesPanel {...props} selectedId={id} />) }
}

const bodyRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1)

describe('QuantitiesPanel', () => {
  it('lists members that read alike as one row, opened on request', async () => {
    panel()
    expect(bodyRows()).toHaveLength(2)
    const group = screen.getByRole('button', { name: 'W14X132 × 3: show each member' })
    expect(group).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(group)
    expect(group).toHaveAttribute('aria-expanded', 'true')
    expect(bodyRows()).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'W14X132, member 4. Show on drawing' })).toBeInTheDocument()
  })

  it('opens the group of a member chosen on the drawing', () => {
    const { rerender } = panel()
    expect(screen.queryByRole('button', { name: /W14X132, member 3/ })).toBeNull()
    rerender('c')
    expect(screen.getByRole('button', { name: 'W14X132, member 3. Show on drawing' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves out the Flags column when no member has a flag', () => {
    panel()
    expect(within(screen.getByRole('table')).queryByRole('columnheader', { name: 'Flags' })).toBeNull()
  })
})

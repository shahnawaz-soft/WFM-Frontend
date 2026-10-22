import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AbmTotals } from '../../api/types'
import { AbmTotalsView } from './AbmTotalsView'

const zero = { lb: '0.0', kg: '0.0', short_tons: '0.000', tonnes: '0.000' }
const count = { entries: 0, quantity: 0 }

const totals = {
  units: { length: '', weight: '', tonnage: '', unit_weight: '' },
  section_dataset: 'AISC Shapes Database v16.0',
  reviewed: { entries: 1, quantity: 1, weight: { lb: '520.0', kg: '235.9', short_tons: '0.260', tonnes: '0.236' } },
  incomplete: { entries: 0, quantity: 0, weight: zero, reasons: { awaiting_review: 0 } },
  not_weighed: { entries: 0, quantity: 0, reasons: { no_length: count, not_in_section_data: count, unsupported: count } },
  not_in_tonnage: { entries: 2, quantity: 2, length_mm: '25603.2', families: ['K', 'KCS', 'LH', 'DLH', 'JG'] },
  estimate_all_weighed: { lb: '520.0', kg: '235.9', short_tons: '0.260', tonnes: '0.236' },
  connection_material: { lines: 0, weight: { lb: '0.0', kg: '0.0', short_tons: '0.000', tonnes: '0.000' }, unweighed: 0 },
  estimate_with_connections: { lb: '520.0', kg: '235.9', short_tons: '0.260', tonnes: '0.236' },
  complete: true,
  groups: [
    { profile: 'LH', designation: '36LH10', entries: 1, quantity: 1, measured_length_mm: '19507.2', unmeasured: 0, unit_weight_lb_per_ft: null, unit_weight_kg_per_m: null, reviewed: null, incomplete: null, weighed: null, not_weighed: 0, counted_in_tonnage: false },
  ],
} as unknown as AbmTotals

describe('Tonnage', () => {
  it('lists joists as counted but not in the tonnage', async () => {
    const onShow = vi.fn()
    render(<AbmTotalsView totals={totals} onShow={onShow} />)
    expect(screen.getByRole('note')).toHaveTextContent("2 joist entries (quantity 2, 84'-0\" in all) are counted in the ABM but not in the tonnage.")
    expect(screen.getByText('Not in tonnage')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '2 joist entries' }))
    expect(onShow).toHaveBeenCalledWith({ match: 'not_in_tonnage' })
  })
})

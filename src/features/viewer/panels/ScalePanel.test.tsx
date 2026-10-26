import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ExtractionRun } from '../../../api/types'
import { ScalePanel } from './ScalePanel'

function run(
  check: Partial<NonNullable<ExtractionRun['scale_check']>>,
  spacing?: Partial<NonNullable<ExtractionRun['grid_spacings']>[number]>,
  extra: Partial<ExtractionRun> = {},
) {
  return {
    review_reasons: [],
    scale_text: '1/8" = 1\'-0"',
    scale_confidence: 0.9,
    summary: { scales_found: ['1/8" = 1\'-0"', '3/4" = 1\'-0"'] },
    scale_check: { checked: 93, agree: 90, implied_ratio: 96, implied_text: '1/8" = 1\'-0"', verdict: 'confirmed', ...check },
    grid_spacings: spacing ? [{ grids: ['3', '4'], text: "32'-0\"", value_mm: 9753.6, drawn_mm: 9753.6, agrees: true, ...spacing }] : [],
    ...extra,
  } as unknown as ExtractionRun
}

describe('Scale panel', () => {
  it('shows a scale confirmed by the printed dimensions', () => {
    render(<ScalePanel run={run({})} />)
    expect(screen.getByText('Confirmed by dimensions')).toBeInTheDocument()
    expect(screen.getByText('90 of 93 printed dimensions measure true at this scale.')).toBeInTheDocument()
  })

  it('warns when the printed dimensions point to another scale', () => {
    render(<ScalePanel run={run({ agree: 0, implied_ratio: 48, implied_text: '1/4" = 1\'-0"', verdict: 'disagrees' })} />)
    expect(screen.getByText('Dimensions disagree')).toBeInTheDocument()
    expect(screen.getByText(/as if the plan were drawn at 1\/4" = 1'-0"\. Lengths were measured at 1\/8" = 1'-0"/)).toBeInTheDocument()
  })

  it('shows what the drawing measures when a printed grid spacing disagrees', () => {
    render(<ScalePanel run={run({}, { agrees: false, drawn_mm: 9144 })} />)
    expect(screen.getByRole('row', { name: /3 – 4 32'-0" Measures 30'-0"/ })).toBeInTheDocument()
  })

  it('says a sheet is marked not to scale instead of "not found"', () => {
    const marked = { scale_text: '', review_reasons: [{ code: 'not_to_scale', message: '' }] } as Partial<ExtractionRun>
    render(<ScalePanel run={run({ checked: 15, agree: 0, verdict: 'unknown' }, undefined, marked)} />)
    expect(screen.getByText('Not to scale')).toBeInTheDocument()
    expect(screen.getByText('Marked on the drawing')).toBeInTheDocument()
    expect(screen.getByText(/marks this sheet or its views “not to scale”/)).toBeInTheDocument()
    expect(screen.queryByText(/measure true at this scale/)).toBeNull()
  })

  it('does not talk about "this scale" when none was found', () => {
    render(<ScalePanel run={run({ checked: 15, agree: 0, verdict: 'unknown' }, undefined, { scale_text: '' })} />)
    expect(screen.getByText('Not found')).toBeInTheDocument()
    expect(screen.getByText('No scale was found to check the 15 printed dimensions against.')).toBeInTheDocument()
  })

  it('renders without a summary (older runs, or keys missing)', () => {
    const noSummary = { ...run({}), summary: undefined } as unknown as ExtractionRun
    render(<ScalePanel run={noSummary} />)
    expect(screen.getByText('Confirmed by dimensions')).toBeInTheDocument()
    expect(screen.queryByText(/states several scales/)).toBeNull()
  })

  it('shows a loading state while the page detail is loading', () => {
    render(<ScalePanel run={undefined} />)
    expect(screen.getByText('Loading the scale…')).toBeInTheDocument()
    expect(screen.queryByText(/Run Plan on this page/)).toBeNull()
  })
})

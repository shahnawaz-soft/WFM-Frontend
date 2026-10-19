import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { DrawingPage, ReviewReason } from '../../api/types'
import { PageResult } from './PageResult'

const LONG = 'The drawing is marked “not to scale”, so lengths cannot be measured from it. '.repeat(2)

function page(reasons: ReviewReason[]) {
  return {
    page_number: 21,
    latest_job: null,
    current_run: { page_kind: 'vector', member_count: 22, scale_text: '', review_reasons: reasons },
  } as unknown as DrawingPage
}

const reasons = () => screen.getByRole('list', { name: 'Why page 21 needs review' })

describe('Review reasons on a page card', () => {
  it('shows a single short reason in full, with nothing to expand', () => {
    render(<PageResult page={page([{ code: 'scale', message: 'No drawing scale was found.' }])} />)
    expect(reasons()).toHaveTextContent('No drawing scale was found.')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the first of several reasons until asked for the rest', async () => {
    render(
      <PageResult
        page={page([
          { code: 'nts', message: LONG },
          { code: 'lengths', message: '22 of 22 members could not be measured reliably.' },
          { code: 'sheet', message: 'This sheet looks like an elevation sheet, not a plan.' },
        ])}
      />,
    )
    expect(reasons()).not.toHaveTextContent('22 of 22 members')
    const toggle = screen.getByRole('button', { name: 'Read more (2 more)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveAttribute('aria-controls', reasons().id)

    await userEvent.click(toggle)
    expect(reasons()).toHaveTextContent('22 of 22 members')
    expect(reasons()).toHaveTextContent('elevation sheet')
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('offers to expand one long reason (it is cut to three lines)', () => {
    render(<PageResult page={page([{ code: 'nts', message: LONG }])} />)
    expect(reasons()).toHaveAttribute('data-collapsed')
    expect(screen.getByRole('button', { name: 'Read more' })).toBeInTheDocument()
  })
})

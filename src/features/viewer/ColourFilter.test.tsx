import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ColourFilter } from './ColourFilter'

describe('review by Tekla colour', () => {
  it('picks one colour, or all, and steps to the next member', async () => {
    const onPick = vi.fn()
    const onNext = vi.fn()
    render(
      <ColourFilter
        counts={[
          ['grid', 94],
          ['scaled', 42],
        ]}
        active="scaled"
        onPick={onPick}
        onNext={onNext}
      />,
    )
    expect(screen.getByRole('button', { name: /Pink 42/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /All 136/ })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: /Green 94/ }))
    expect(onPick).toHaveBeenCalledWith('grid')
    await userEvent.click(screen.getByRole('button', { name: /All/ }))
    expect(onPick).toHaveBeenCalledWith(null)
    await userEvent.click(screen.getByRole('button', { name: /Next/ }))
    expect(onNext).toHaveBeenCalled()
  })
})

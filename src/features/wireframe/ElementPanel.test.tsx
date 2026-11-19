import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { WireframeGrid } from '../../api/types'
import { AddElementForm } from './ElementPanel'

const grid = (label: string, direction: 'x' | 'y', position_mm: string): WireframeGrid => ({
  label,
  direction,
  position_mm,
  angle_deg: null,
  start_mm: null,
  end_mm: null,
})
const GRIDS = [grid('A', 'x', '0.0'), grid('B', 'x', '9144.0'), grid('1', 'y', '0.0'), grid('2', 'y', '7620.0')]

function renderForm(grids: WireframeGrid[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddElementForm wireframeId="w1" grids={grids} onAdded={() => {}} onCancel={() => {}} />
    </QueryClientProvider>,
  )
}

describe('placing by grid (old Wireframer)', () => {
  it('a new column at a grid crossing and offset gets that x and y at both ends', async () => {
    renderForm(GRIDS)
    await userEvent.click(screen.getByRole('button', { name: 'Place start by grid' }))
    await userEvent.selectOptions(screen.getByLabelText('Start X grid'), 'B')
    const offset = screen.getByLabelText('Start X offset')
    await userEvent.clear(offset)
    await userEvent.type(offset, "-2'-6\"")
    await userEvent.selectOptions(screen.getByLabelText('Start Y grid'), '2')
    await userEvent.click(screen.getByRole('button', { name: 'Use this point' }))
    expect(screen.getByLabelText('Start x')).toHaveValue("27'-6\"")
    expect(screen.getByLabelText('Start y')).toHaveValue("25'-0\"")
    expect(screen.getByLabelText('End x')).toHaveValue("27'-6\"")
    expect(screen.getByLabelText('End y')).toHaveValue("25'-0\"")
  })

  it('a project without grid lines shows the fields only, as before', () => {
    renderForm([])
    expect(screen.queryByRole('button', { name: /by grid/ })).toBeNull()
    expect(screen.getByLabelText('Start x')).toBeInTheDocument()
  })
})

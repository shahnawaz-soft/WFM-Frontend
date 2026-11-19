import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { GridSource, ProjectGrid } from '../../api/types'
import { GridSources } from './GridSources'

const SOURCES: GridSource[] = [
  { page_id: 'p1', page_number: 23, sheet_number: 'S222', level_label: 'LEVEL 02', position_mm: '9144.0', position_display: "30'-0\"", reference_label: 'A/1', from_reference_mm: '9144.0', from_reference_display: "30'-0\"", measured_by: 'printed_dimensions', agrees: true },
  { page_id: 'p2', page_number: 24, sheet_number: 'S232', level_label: 'LEVEL 03', position_mm: '9448.8', position_display: "31'-0\"", reference_label: 'A/1', from_reference_mm: '9448.8', from_reference_display: "31'-0\"", measured_by: 'drawn_at_scale', agrees: false },
]
vi.mock('../../api/wireframe', () => ({ getGridSources: async () => SOURCES }))

describe('where a grid comes from', () => {
  it('lists each plan, how it placed the line, and the one that disagrees', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <GridSources projectId="pr" grid={{ id: 'g2', label: '2', position_display: "30'-0\"" } as ProjectGrid} onClose={() => {}} />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('link', { name: 'p.24 · S232' })).toHaveAttribute('href', '/projects/pr/pages/p2')
    expect(screen.getByText('drawn length at the sheet scale')).toBeInTheDocument()
    expect(screen.getByText('⚠ No')).toBeInTheDocument()
    expect(screen.getAllByText('Yes')).toHaveLength(1)
  })
})

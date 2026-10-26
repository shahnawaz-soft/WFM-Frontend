import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DrawingPage, ExtractionRun } from '../../../api/types'
import { createTestQueryClient } from '../../../test/renderApp'
import { PagePanel } from './PagePanel'

const RUN = {
  id: 'r1',
  status: 'active',
  engine_name: 'vector-labels',
  engine_version: '1.45',
  engine_outdated: false,
  current_engine_version: '1.45',
  page_kind: 'vector',
  review_reasons: [],
  scale_text: '',
  scale_ratio: null,
  scale_confidence: null,
  member_count: 3,
  created_at: '2026-10-26T09:00:00Z',
}

const page = {
  id: 'pg1',
  page_number: 1,
  status: 'processed',
  width_pt: 2384,
  height_pt: 1684,
  rotation: 0,
  error_message: '',
  latest_job: null,
  current_run: RUN,
} as unknown as DrawingPage

function renderPanel(run: ExtractionRun | null | undefined) {
  return render(
    <QueryClientProvider client={createTestQueryClient()}>
      <PagePanel page={page} run={run} canRun={false} />
    </QueryClientProvider>,
  )
}

describe('Page panel', () => {
  it('renders without a summary (older runs, or keys missing)', () => {
    renderPanel(RUN as unknown as ExtractionRun)
    expect(screen.getByText('Vector lines').nextSibling).toHaveTextContent('—')
    expect(screen.getByText('Text characters').nextSibling).toHaveTextContent('—')
    expect(screen.queryByText('Sheet')).toBeNull()
    expect(screen.getByText('vector-labels 1.45')).toBeInTheDocument()
  })

  it('renders a summary with only some keys', () => {
    renderPanel({ ...RUN, summary: { paths: 36986 } } as unknown as ExtractionRun)
    expect(screen.getByText('Vector lines').nextSibling).toHaveTextContent('36,986')
    expect(screen.getByText('Text characters').nextSibling).toHaveTextContent('—')
  })

  it('shows a loading state for the analysis while the page detail is loading', () => {
    renderPanel(undefined)
    expect(screen.getByText('Loading the page analysis…')).toBeInTheDocument()
    expect(screen.queryByText('Vector lines')).toBeNull()
  })
})

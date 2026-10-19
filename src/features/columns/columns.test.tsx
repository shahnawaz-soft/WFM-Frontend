import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const OWNER = 'estimator@steelo.test'

async function call(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

/** One processed page (three column symbols) added to the project. */
async function addedPage() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:1'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  await call('POST', `/drawing-pages/${page.id}/run-plan/`)
  await call('POST', `/drawing-pages/${page.id}/accept-all/`)
  const members = await call('GET', `/drawing-pages/${page.id}/members/`)
  const hss = members.find((m: { profile: string }) => m.profile === 'HSS')
  await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'unsupported' })
  await call('POST', `/drawing-pages/${page.id}/mark-reviewed/`)
  await call('POST', `/drawing-pages/${page.id}/add-to-project/`)
  return { project, page }
}

describe('Column schedule', () => {
  it('says which pages still need a reference point', async () => {
    const { project } = await addedPage()
    renderApp(`/projects/${project.id}/columns`)
    expect(await screen.findByRole('heading', { name: 'Column schedule' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Page 1' })).toHaveAttribute('href', expect.stringContaining('tab=level'))
    expect(screen.getByText(/No columns yet/)).toBeInTheDocument()
  })

  it('lists columns by grid and level, and adds them to the ABM', async () => {
    const { project, page } = await addedPage()
    await call('PATCH', `/drawing-pages/${page.id}/level/`, { level_label: 'Level 2', elevation: "14'", reference_point: [150, 95] })
    renderApp(`/projects/${project.id}/columns`)
    const table = await screen.findByRole('table', { name: /Columns by grid crossing/ })
    // One column per storey: its span and the levels at each end.
    expect(within(table).getByRole('columnheader', { name: /0'-0" → 14'-0".*Level 2/ })).toBeInTheDocument()
    const row = within(table).getByRole('row', { name: /A\/1/ })
    expect(within(row).getByText('Size not given')).toBeInTheDocument()
    expect(within(row).queryByText(`14'-0"`)).toBeNull() // the storey's height is in its header
    expect(within(row).getByText('Size needed')).toBeInTheDocument() // one status tag per cell
    expect(within(row).getByTitle(/From its symbol · page 1/)).toBeInTheDocument() // the rest on hover
    expect(screen.getByText(/without a section/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Add 3 to the ABM' }))
    expect(await screen.findByText('ABM updated')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('button', { name: /to the ABM/ })).toBeNull())
    expect(within(screen.getByRole('row', { name: /A\/1/ })).getByRole('link', { name: 'Size not given' })).toHaveAttribute(
      'href',
      expect.stringContaining('/abm?member='),
    )
  })

  it('shows a column once per storey, with its copies on other plans and what is not placed', async () => {
    const project = mockProjects.create('Structures', OWNER)
    mockBackend.startSession(OWNER)
    const cell = (page: number, values: object) => ({
      page_id: `p${page}`,
      page_number: page,
      level_label: '',
      elevation_mm: '0.0',
      designation: 'W12X106',
      source: 'symbol',
      member_id: null,
      in_bill: true,
      same_as_page: null,
      schedule_page: 9,
      height_mm: '4419.6',
      height_display: '14\'-6"',
      base_mm: '0.0',
      issues: [],
      issue_messages: [],
      ...values,
    })
    const storey = { base_mm: '0.0', top_mm: '4419.6', base_display: '0\'-0"', top_display: '14\'-6"', base_levels: ['FOUNDATION'], top_levels: ['2ND FLR FRM'] }
    server.use(
      http.get('*/api/v1/projects/:id/column-schedule/', () =>
        HttpResponse.json({
          levels: [],
          storeys: [storey],
          stacks: [
            // Counted on the foundation plan (p.10); the 2nd floor plan (p.12) shows the same storey.
            { grid: 'A/05', x: '0.0', y: '0.0', cells: [cell(10, {}), cell(12, { same_as_page: 10, height_mm: null, height_display: '' })] },
            { grid: 'near D/05', x: '0.0', y: '-10480.0', cells: [cell(18, { designation: 'HSS8X8X5/8', schedule_page: null, height_mm: null, height_display: '', base_mm: null, issues: ['no_level_below'], issue_messages: ['No level below this one.'] })] },
          ],
          skipped_pages: [],
          columns: 2,
          without_size: 0,
          not_in_bill: 0,
        }),
      ),
    )
    renderApp(`/projects/${project.id}/columns`)
    const table = await screen.findByRole('table', { name: /Columns by grid crossing/ })
    const counted = within(table).getByRole('row', { name: /A\/05/ })
    expect(within(counted).getAllByText('W12X106')).toHaveLength(1) // not repeated for the copy
    expect(within(counted).getByText('Also shown on p.12')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: 'Not placed' })).toBeInTheDocument()
    const post = within(table).getByRole('row', { name: /near D\/05/ })
    expect(within(post).getByText('height unknown')).toBeInTheDocument()
    expect(within(post).getByText('No level below this one.')).toBeInTheDocument()
    expect(screen.getByText(/over 1 storey/)).toBeInTheDocument()
  })
})

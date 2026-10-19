import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

vi.mock('../viewer/pdf', () => ({ loadPdf: async () => ({ numPages: 2 }) }))
vi.mock('../viewer/PdfPageCanvas', async () => {
  const { useEffect } = await import('react')
  return {
    PdfPageCanvas: ({ zoom, label, onViewport }: { zoom: number; label: string; onViewport?: (vp: unknown) => void }) => {
      useEffect(() => {
        onViewport?.({
          scale: zoom,
          width: 2384 * zoom,
          height: 1684 * zoom,
          convertToViewportRectangle: ([l, b, r, t]: number[]) => [l! * zoom, (1684 - b!) * zoom, r! * zoom, (1684 - t!) * zoom],
          convertToViewportPoint: (x: number, y: number) => [x * zoom, (1684 - y) * zoom],
        })
      }, [zoom, onViewport])
      return <div role="img" aria-label={label} data-zoom={zoom} />
    },
  }
})

const OWNER = 'estimator@steelo.test'

/** Calls the mock API directly to prepare state (the UI for these steps is tested elsewhere). */
async function call(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

/** Page 1 processed, reviewed (HSS marked unsupported) and optionally added to the project. */
async function projectWithReviewedPage({ add = true } = {}) {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' })
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:2'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  await call('POST', `/drawing-pages/${page.id}/run-plan/`)
  await call('POST', `/drawing-pages/${page.id}/accept-all/`)
  const members = await call('GET', `/drawing-pages/${page.id}/members/`)
  const hss = members.find((m: { profile: string }) => m.profile === 'HSS')
  await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'unsupported' })
  await call('POST', `/drawing-pages/${page.id}/mark-reviewed/`)
  if (add) await call('POST', `/drawing-pages/${page.id}/add-to-project/`)
  return { project, page, members }
}

const shapes = (container: HTMLElement) => [...container.querySelectorAll<SVGRectElement>('.member-overlay rect')]

async function openAbm(path = '') {
  const setup = await projectWithReviewedPage()
  const view = renderApp(`/projects/${setup.project.id}/abm${path}`)
  const table = await screen.findByRole('table', { name: /ABM/ })
  return { ...setup, ...view, table }
}

describe('ABM', () => {
  it('shows the whole design as a draft, before any page is reviewed or added', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    await acceptUpload(project.id, new File(['%PDF-1.7 pages:2'], 'GA.pdf'))
    await call('POST', `/drawing-pages/${mockDrawings.sets[0]!.pages[0]!.id}/run-plan/`) // run only
    renderApp(`/projects/${project.id}/abm`)
    await userEvent.click(await screen.findByRole('checkbox', { name: /Show every processed page/ }))
    const table = await screen.findByRole('table', { name: /ABM/ })
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(3)
    expect(screen.getByText(/Draft ABM: every page that has been run/)).toBeInTheDocument()
    expect(screen.getByText('Draft tonnage')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download draft (Excel)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Export/ })).not.toBeInTheDocument() // only versions are final
  })

  it('is reached from the project page', async () => {
    const { project } = await projectWithReviewedPage()
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'ABM' })
    expect(await within(card).findByText('3')).toBeInTheDocument()
    expect(within(card).getByText(/1 unsupported/)).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('link', { name: 'Open ABM' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'ABM' })).toBeInTheDocument()
  })

  it('lists entries with their source page and how their values were obtained', async () => {
    const { table } = await openAbm()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('p.1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Estimated')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('26')).toBeInTheDocument() // lb/ft
    expect(within(rows[2]!).getByText('Unsupported')).toBeInTheDocument()

    const stats = screen.getByLabelText('ABM summary')
    expect(within(stats).getByText('Entries').nextSibling).toHaveTextContent('3')
    expect(within(stats).getByText('Unsupported').nextSibling).toHaveTextContent('1')
  })

  it('selecting an entry shows it on its drawing; selecting on the drawing selects the entry', async () => {
    const { table, container } = await openAbm()
    await waitFor(() => expect(shapes(container)).toHaveLength(3))
    const second = within(table).getByRole('button', { name: 'W12X26, entry 2, page 1. Show on drawing' })
    await userEvent.click(second)
    expect(second).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(shapes(container)[1]).toHaveAttribute('data-selected', 'true'))
    expect(screen.getByRole('region', { name: /W12X26 · entry 2/ })).toBeInTheDocument()

    await userEvent.click(shapes(container)[2]!)
    expect(within(table).getByRole('button', { name: /^HSS6X6X1\/4, entry 3/ })).toHaveAttribute('aria-pressed', 'true')
    expect(second).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('link', { name: 'Open page' })).toHaveAttribute('href', expect.stringContaining('?member='))
  })

  it('selects an entry by clicking anywhere on its row', async () => {
    const { table } = await openAbm()
    const rows = within(table).getAllByRole('row').slice(1)
    await userEvent.click(within(rows[1]!).getByText('p.1'))
    expect(within(rows[1]!).getByRole('button', { name: /^W12X26, entry 2/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('region', { name: /W12X26 · entry 2/ })).toBeInTheDocument()
  })

  it('edits an entry and recalculates the totals', async () => {
    const { table } = await openAbm()
    await userEvent.click(within(table).getByRole('button', { name: /^W12X26, entry 1/ }))
    const editor = screen.getByRole('region', { name: /entry 1/ })
    const quantity = within(editor).getByLabelText('Quantity')
    await userEvent.clear(quantity)
    await userEvent.type(quantity, '4')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    expect(await within(editor).findByText('Changes saved')).toBeInTheDocument()

    const summary = screen.getByLabelText('ABM summary')
    await waitFor(() => expect(within(summary).getByText('Quantity').nextSibling).toHaveTextContent('6'))
    await waitFor(() => expect(within(summary).getByText('Corrected').nextSibling).toHaveTextContent('1'))
    const row = within(table).getByRole('button', { name: /^W12X26, entry 1/ }).closest('tr')!
    expect(within(row).getByText('Corrected')).toBeInTheDocument()
  })

  it('filters by section type and status, and clears filters', async () => {
    const { table } = await openAbm()
    await userEvent.selectOptions(screen.getByLabelText('Section type'), 'HSS')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'open')
    expect(await screen.findByText('No entries match these filters.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters (2)' }))
    const all = await screen.findByRole('table', { name: /ABM/ })
    await waitFor(() => expect(within(all).getAllByRole('row')).toHaveLength(4))
  })

  it('searches and explains an invalid length filter', async () => {
    const { table } = await openAbm()
    await userEvent.type(screen.getByLabelText('Search'), 'hss')
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))

    await userEvent.click(screen.getByRole('button', { name: 'More filters' }))
    await userEvent.type(screen.getByLabelText('Shortest length'), 'far')
    await userEvent.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(/feet and inches/)
  })

  it('adds an entry to a chosen page', async () => {
    const { table } = await openAbm()
    await userEvent.click(screen.getByRole('button', { name: '+ Add entry' }))
    expect(screen.getByLabelText('Add to page')).toHaveDisplayValue('Page 1 · GA.pdf')
    await userEvent.type(screen.getByLabelText('Section'), 'W10X12')
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    const manual = await within(table).findByRole('button', { name: /^W10X12, entry 4/ })
    await waitFor(() => expect(manual).toHaveAttribute('aria-pressed', 'true'))
    expect(within(manual.closest('tr')!).getByText('Manual')).toBeInTheDocument()
  })

  it('explains how pages get into the ABM when there are none', async () => {
    const { project } = await projectWithReviewedPage({ add: false })
    renderApp(`/projects/${project.id}/abm`)
    expect(await screen.findByRole('heading', { name: 'No pages in the ABM yet' })).toBeInTheDocument()
    expect(screen.getByText(/1 reviewed and 0 processed/)).toBeInTheDocument()
  })

  it('viewers can look but not add entries', async () => {
    const { project } = await projectWithReviewedPage()
    mockBackend.startSession('viewer@steelo.test')
    renderApp(`/projects/${project.id}/abm`)
    await screen.findByRole('table', { name: /ABM/ })
    expect(screen.queryByRole('button', { name: '+ Add entry' })).not.toBeInTheDocument()
  })
})

describe('Adding pages to the project', () => {
  it('adds a reviewed page from the page workspace and can remove it again', async () => {
    const { project, page } = await projectWithReviewedPage({ add: false })
    renderApp(`/projects/${project.id}/pages/${page.id}`)
    await screen.findByRole('heading', { level: 1, name: /^Page 1/ })
    expect(await screen.findByText(/Adding puts the 3 non-rejected members/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add to project' }))
    expect(await screen.findByText('Page 1 added to the project')).toBeInTheDocument()
    const link = await screen.findByRole('link', { name: 'Open ABM' })
    expect(link).toHaveAttribute('href', `/projects/${project.id}/abm`)

    // Entries stay editable once the page is in the project (OD-31).
    await userEvent.click(screen.getByRole('button', { name: 'W12X26, member 1. Show on drawing' }))
    const editor = screen.getByRole('region', { name: /member 1$/ })
    expect(within(editor).getByLabelText('Quantity')).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Show in ABM' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Remove from project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove page 1 from the project?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove from project' }))
    expect(await screen.findByRole('button', { name: 'Add to project' })).toBeInTheDocument()
  })

  it('opens the page workspace at a member linked from the ABM', async () => {
    const { project, page, members } = await projectWithReviewedPage()
    renderApp(`/projects/${project.id}/pages/${page.id}?member=${members[1].id}`)
    const row = await screen.findByRole('button', { name: 'W12X26, member 2. Show on drawing' })
    expect(row).toHaveAttribute('aria-pressed', 'true')
  })
})

// Mock data: W12X26 (no length), W12X26 33'-4" = 26 × 33.33 = 866.7 lb, HSS unsupported.
describe('Tonnage', () => {
  it('shows the reviewed tonnage and says when it is not complete', async () => {
    await openAbm()
    const summary = screen.getByLabelText('ABM summary')
    expect(await within(summary).findByText(/0\.43 US tons/)).toBeInTheDocument()
    expect(within(summary).getByText(/not complete/)).toBeInTheDocument()
  })

  it('splits totals into reviewed, not final and not weighed, with the reasons', async () => {
    const { table } = await openAbm()
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('867') // weight column (lb)
    await userEvent.click(screen.getByRole('button', { name: 'Totals by section' }))
    const reviewed = await screen.findByRole('region', { name: 'Reviewed total' })
    expect(within(reviewed).getByText('0.43 US tons')).toBeInTheDocument()
    expect(within(reviewed).getByText(/0\.39 t · 867 lb · 393 kg/)).toBeInTheDocument()
    const missing = screen.getByRole('region', { name: 'Not weighed' })
    expect(within(missing).getByText('2 entries')).toBeInTheDocument()
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(/not complete yet/)

    // A reason leads to the entries behind it.
    await userEvent.click(within(missing).getByRole('button', { name: '1 without a length' }))
    const list = await screen.findByRole('table', { name: /ABM/ })
    await waitFor(() => expect(within(list).getAllByRole('row')).toHaveLength(2))
    expect(screen.getByRole('checkbox', { name: 'No length' })).toBeChecked()
  })

  it('groups by section with subtotals and opens a section’s entries', async () => {
    const { project } = await projectWithReviewedPage()
    renderApp(`/projects/${project.id}/abm?view=totals`)
    const groups = await screen.findByRole('table', { name: 'Quantities and weights by section' })
    const w12 = within(groups).getByRole('button', { name: 'W12X26: show its entries' }).closest('tr')!
    expect(w12).toHaveTextContent(/^W12X26 *2 *2 *33'-4" \+1 unmeasured *26 *867/)
    expect(within(groups).getByRole('rowheader', { name: 'W subtotal' })).toBeInTheDocument()

    await userEvent.click(within(groups).getByRole('button', { name: 'W12X26: show its entries' }))
    const list = await screen.findByRole('table', { name: /ABM/ })
    await waitFor(() => expect(within(list).getAllByRole('row')).toHaveLength(3))
    await userEvent.click(screen.getByRole('button', { name: 'Stop showing only W12X26' }))
    await waitFor(() => expect(within(list).getAllByRole('row')).toHaveLength(4))
  })

  it('recalculates member weight and tonnage after a correction', async () => {
    const { table } = await openAbm()
    await userEvent.click(within(table).getByRole('button', { name: /^W12X26, entry 1/ }))
    const editor = screen.getByRole('region', { name: /entry 1/ })
    expect(within(editor).getByText('Weight: needs a length')).toBeInTheDocument()
    const length = within(editor).getByLabelText('Length')
    await userEvent.type(length, "10'")
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    expect(await within(editor).findByText('260 lb')).toBeInTheDocument() // 26 lb/ft × 10 ft
    const summary = screen.getByLabelText('ABM summary')
    expect(await within(summary).findByText(/0\.56 US tons/)).toBeInTheDocument() // 866.7 + 260 lb
  })

  it('shows the reviewed tonnage on the project page', async () => {
    const { project } = await projectWithReviewedPage()
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'ABM' })
    expect(await within(card).findByText('0.43 US tons')).toBeInTheDocument()
  })
})

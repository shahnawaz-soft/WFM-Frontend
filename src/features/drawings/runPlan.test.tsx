import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

vi.mock('../../api/drawings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/drawings')>()),
  uploadDrawingSet: (projectId: string, file: File, options: Parameters<typeof acceptUpload>[2]) =>
    acceptUpload(projectId, file, options),
}))

const OWNER = 'estimator@steelo.test'

async function projectWithPages(pages = 2, role: 'owner' | 'viewer' = 'owner') {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' })
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File([`%PDF-1.7 pages:${pages}`], 'GA.pdf'))
  if (role === 'viewer') mockBackend.startSession('viewer@steelo.test')
  renderApp(`/projects/${project.id}`)
  return screen.findByRole('list', { name: 'Pages of GA.pdf' })
}

const pageCard = (grid: HTMLElement, n: number) => within(grid).getByRole('listitem', { name: `Page ${n}` })

describe('Run Plan', () => {
  it('processes a page and shows the result with its status', async () => {
    const grid = await projectWithPages()
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))

    const card = pageCard(grid, 1)
    expect(await within(card).findByText('Completed')).toBeInTheDocument()
    expect(within(card).getByText('Processed')).toBeInTheDocument()
    expect(within(card).getByText('Vector drawing')).toBeInTheDocument()
    expect(within(card).getByText(/3 member labels · 1\/8" = 1'-0"/)).toBeInTheDocument()
    // Page 2 is untouched: pages are processed individually.
    expect(within(pageCard(grid, 2)).getByText('Pending')).toBeInTheDocument()
  })

  it('shows progress while a page is processing', async () => {
    mockDrawings.runOutcome(1, 'stay_processing')
    const grid = await projectWithPages()
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))
    const card = pageCard(grid, 1)
    const bar = await within(card).findByRole('progressbar', { name: 'Processing page 1' })
    expect(bar).toHaveAttribute('aria-valuenow', '40')
    expect(within(card).getByText('Processing — Analysing page content')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /page 1/ })).not.toBeInTheDocument() // no double start
  })

  it('explains why a page needs review', async () => {
    mockDrawings.runOutcome(1, 'needs_review')
    const grid = await projectWithPages()
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))
    const card = pageCard(grid, 1)
    expect(await within(card).findByText('Needs review')).toBeInTheDocument()
    const reasons = within(card).getByRole('list', { name: 'Why page 1 needs review' })
    expect(reasons).toHaveTextContent('appears to be a scanned image')
  })

  it('shows a failure and retries it', async () => {
    mockDrawings.runOutcome(1, 'failed')
    const grid = await projectWithPages()
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))
    const card = pageCard(grid, 1)
    expect(await within(card).findByText(/Processing failed unexpectedly. Nothing was lost/)).toBeInTheDocument()
    expect(within(card).getAllByText('Failed').length).toBeGreaterThan(0)

    await userEvent.click(within(card).getByRole('button', { name: 'Retry — page 1' }))
    expect(await within(card).findByText('Completed')).toBeInTheDocument()
  })

  it('asks before running a processed page again', async () => {
    const grid = await projectWithPages()
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))
    const rerun = await within(pageCard(grid, 1)).findByRole('button', { name: 'Run again — page 1' })
    await userEvent.click(rerun)
    const dialog = await screen.findByRole('dialog', { name: 'Run page 1 again?' })
    expect(within(dialog).getByText(/previous result is kept/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Run again' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('is not offered to viewers', async () => {
    const grid = await projectWithPages(2, 'viewer')
    expect(within(grid).queryByRole('button', { name: /Run Plan/ })).not.toBeInTheDocument()
  })

  it('runs every page not run yet with "Run all pages"', async () => {
    const grid = await projectWithPages(3)
    await userEvent.click(within(pageCard(grid, 1)).getByRole('button', { name: 'Run Plan — page 1' }))
    expect(await within(pageCard(grid, 1)).findByText('Completed')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Run all pages' }))
    expect(await screen.findByText('Running 2 pages')).toBeInTheDocument() // page 1 was already run
    for (const n of [2, 3]) expect(await within(pageCard(grid, n)).findByText('Completed')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Run all pages' }))
    expect(await screen.findByText('Every page has already been run')).toBeInTheDocument()
  })

  it('does not offer "Run all pages" to viewers', async () => {
    await projectWithPages(2, 'viewer')
    expect(screen.queryByRole('button', { name: 'Run all pages' })).not.toBeInTheDocument()
  })
})

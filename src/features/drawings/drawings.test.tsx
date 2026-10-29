import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

// jsdom's XHR cannot transmit multipart files; route uploads to the in-memory mock server.
vi.mock('../../api/drawings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/drawings')>()),
  uploadDrawingSet: (projectId: string, file: File, options: Parameters<typeof acceptUpload>[2]) =>
    acceptUpload(projectId, file, options),
}))

const OWNER = 'estimator@steelo.test'

function pdfFile(name: string, pages = 3, content = '') {
  return new File([`%PDF-1.7 pages:${pages} ${content}`], name, { type: 'application/pdf' })
}

async function openProject(role: 'owner' | 'viewer' = 'owner', status: 'active' | 'archived' = 'active') {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' }, status)
  mockBackend.startSession(role === 'owner' ? OWNER : 'viewer@steelo.test')
  const view = renderApp(`/projects/${project.id}`)
  await screen.findByRole('heading', { level: 1, name: 'Warehouse' })
  return { project, ...view }
}

async function chooseFile(container: HTMLElement, file: File) {
  await screen.findByRole('button', { name: 'Choose PDF…' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Choose PDF…' })).toBeEnabled())
  const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
  await userEvent.upload(input, file, { applyAccept: false })
}

beforeEach(() => {
  // keep each test's MSW state independent (also reset globally in setup)
  mockDrawings.reset()
})

describe('Drawing upload', () => {
  it('explains supported files and limits before upload', async () => {
    await openProject()
    expect(await screen.findByText(/up to 200 MB · up to 300 pages per set/)).toBeInTheDocument()
    expect(screen.getByText('Password-protected PDFs cannot be processed.')).toBeInTheDocument()
    expect(screen.getByText('No drawings yet')).toBeInTheDocument()
  })

  it('uploads a set and shows every page with its status', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('GA Plans.pdf', 3))

    expect(await screen.findByText('Drawing set uploaded')).toBeInTheDocument()
    const set = await screen.findByRole('article', { name: 'GA Plans.pdf' })
    expect(await within(set).findByText('Ready')).toBeInTheDocument()
    const pages = await within(set).findByRole('list', { name: 'Pages of GA Plans.pdf' })
    expect(within(pages).getAllByRole('listitem')).toHaveLength(3)
    expect(within(pages).getAllByText('Pending')).toHaveLength(3)
    expect(within(pages).getByText('Page 3')).toBeInTheDocument()
  })

  it('rejects unsupported files before uploading', async () => {
    const { container } = await openProject()
    await chooseFile(container, new File(['x'], 'model.dwg'))
    expect(await screen.findByRole('alert')).toHaveTextContent('“model.dwg” is not a supported file. Supported: .pdf.')
    expect(mockDrawings.sets).toHaveLength(0)
  })

  it('shows the server’s reason when a file is not really a PDF', async () => {
    const { container } = await openProject()
    await chooseFile(container, new File(['PK zip'], 'fake.pdf'))
    expect(await screen.findByRole('alert')).toHaveTextContent('This file is not a PDF')
  })

  it('asks before uploading a duplicate and keeps both copies', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('GA.pdf', 2, 'same'))
    await screen.findByRole('article', { name: 'GA.pdf' })

    await chooseFile(container, pdfFile('GA again.pdf', 2, 'same'))
    const dialog = await screen.findByRole('dialog', { name: 'This file is already in the project' })
    expect(within(dialog).getByText(/already uploaded to this project as “GA.pdf”/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload anyway' }))

    expect(await screen.findByRole('article', { name: 'GA again.pdf' })).toBeInTheDocument()
    expect(mockDrawings.sets).toHaveLength(2)
  })

  it('flags a failed page, keeps the rest, and retries only what failed', async () => {
    mockDrawings.failPages('Mixed.pdf', [2])
    const { container } = await openProject()
    await chooseFile(container, pdfFile('Mixed.pdf', 3))

    const set = await screen.findByRole('article', { name: 'Mixed.pdf' })
    expect(await within(set).findByText('Ready — 1 page failed')).toBeInTheDocument()
    const pages = await within(set).findByRole('list', { name: 'Pages of Mixed.pdf' })
    const page2 = within(pages).getByText('Page 2').closest('li')!
    expect(within(page2).getByText('Failed')).toBeInTheDocument()
    expect(within(page2).getByText(/Page 2 could not be read/)).toBeInTheDocument()
    expect(within(pages).getAllByText('Pending')).toHaveLength(2)

    await userEvent.click(within(set).getByRole('button', { name: 'Retry failed pages' }))
    expect(await within(set).findByText('Ready')).toBeInTheDocument()
    await waitFor(() => expect(within(set).queryByText('Failed')).not.toBeInTheDocument())
    expect(within(set).queryByRole('button', { name: 'Retry failed pages' })).not.toBeInTheDocument()
    expect(mockDrawings.sets[0]!.pages).toHaveLength(3) // no duplicate pages
  })

  it('says preparing the pages timed out and prepares the rest on Retry', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('Big.pdf', 3))
    await screen.findByRole('article', { name: 'Big.pdf' })
    const stored = mockDrawings.sets[0]!
    Object.assign(stored.set, {
      status: 'failed',
      error_code: 'ingest_timed_out',
      error_message: 'Preparing the pages took too long and stopped before the end. The pages already prepared are kept. Retry to prepare the rest.',
    })
    stored.pages.slice(1).forEach((p) => Object.assign(p, { thumbnail_status: 'pending' }))
    cleanup()
    renderApp(`/projects/${mockProjects.all[0]!.id}`)

    const set = await screen.findByRole('article', { name: 'Big.pdf' })
    expect(within(set).getByText('Timed out')).toBeInTheDocument()
    expect(within(set).getByText(/took too long.*Retry to prepare the rest/)).toBeInTheDocument()
    await userEvent.click(within(set).getByRole('button', { name: 'Retry' }))
    expect(await within(set).findByText('Ready')).toBeInTheDocument()
    expect(within(set).queryByText(/took too long/)).not.toBeInTheDocument()
    expect(within(set).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('toggles the page list accessibly', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('GA.pdf', 1))
    const set = await screen.findByRole('article', { name: 'GA.pdf' })
    const toggle = await within(set).findByRole('button', { name: 'Hide pages' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(toggle)
    expect(within(set).getByRole('button', { name: 'Show pages' })).toHaveAttribute('aria-expanded', 'false')
    expect(within(set).queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('Removing a drawing set', () => {
  it('removes a set after confirmation', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('E101-RA.pdf', 1))
    const set = await screen.findByRole('article', { name: 'E101-RA.pdf' })
    await userEvent.click(within(set).getByRole('button', { name: 'Remove E101-RA.pdf' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove “E101-RA.pdf”?' })
    expect(within(dialog).getByText(/original file is kept for the project history/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove drawing set' }))

    expect(await screen.findByText('Removed “E101-RA.pdf”')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('article', { name: 'E101-RA.pdf' })).not.toBeInTheDocument())
    expect(screen.getByText('No drawings yet')).toBeInTheDocument()
  })

  it('removes a processed set, warning when its pages are in the ABM', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('Used.pdf', 1))
    const set = await screen.findByRole('article', { name: 'Used.pdf' })
    Object.assign(mockDrawings.sets[0]!.pages[0]!, { status: 'added' }) // its members are in the ABM
    await userEvent.click(within(set).getByRole('button', { name: 'Remove Used.pdf' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/1 page is in the ABM/)).toBeInTheDocument() // counted afresh on open
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove drawing set' }))
    expect(await screen.findByText('Removed “Used.pdf”')).toBeInTheDocument()
  })

  it('explains when a set is still being processed', async () => {
    const { container } = await openProject()
    await chooseFile(container, pdfFile('Busy.pdf', 1))
    const set = await screen.findByRole('article', { name: 'Busy.pdf' })
    Object.assign(mockDrawings.sets[0]!.pages[0]!, { status: 'processing' })
    await userEvent.click(within(set).getByRole('button', { name: 'Remove Busy.pdf' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove drawing set' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('while its pages are being processed')
  })

  it('is not offered to viewers', async () => {
    await openProject('viewer')
    await screen.findByText('Drawing sets uploaded to this project appear here.')
    expect(screen.queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
  })
})

describe('Drawing permissions', () => {
  it('viewers see drawings but cannot upload', async () => {
    await openProject('viewer')
    expect(await screen.findByText('Drawing sets uploaded to this project appear here.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose PDF…' })).not.toBeInTheDocument()
  })

  it('archived projects hide the upload panel', async () => {
    await openProject('owner', 'archived')
    await screen.findByText(/archived and read-only/)
    expect(screen.queryByRole('button', { name: 'Choose PDF…' })).not.toBeInTheDocument()
  })
})

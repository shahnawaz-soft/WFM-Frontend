import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

vi.mock('../viewer/pdf', () => ({ loadPdf: async () => ({ numPages: 1 }) }))
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
      return <div role="img" aria-label={label} />
    },
  }
})

const OWNER = 'estimator@steelo.test'

async function processedPage() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:1'], 'GA.pdf'))
  renderApp(`/projects/${project.id}/pages/${mockDrawings.sets[0]!.pages[0]!.id}`)
  await screen.findByRole('heading', { level: 1, name: /^Page 1/ })
  await userEvent.click(screen.getByRole('tab', { name: /^Page/ }))
  await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Run Plan' }))
  await within(screen.getByRole('tabpanel')).findByText('Completed')
  await userEvent.click(screen.getByRole('tab', { name: /^Quantities/ }))
  return screen.findByRole('table', { name: /Detected members/ })
}

describe('Section weights in Quantities', () => {
  it('shows weight per foot for matched sections and flags the rest', async () => {
    const table = await processedPage()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(within(rows[0]!).getByText('26')).toBeInTheDocument() // W12X26 = 26 lb/ft
    expect(within(rows[2]!).getByText(/Unsupported type/)).toBeInTheDocument() // HSS
  })

  it('re-matches after a correction and explains a missing match', async () => {
    const table = await processedPage()
    await userEvent.click(within(table).getByRole('button', { name: 'W12X26, member 1. Show on drawing' }))
    const editor = screen.getByRole('region', { name: /member 1$/ })
    expect(within(editor).getByText(/26 lb\/ft \(38\.692 kg\/m\)/)).toBeInTheDocument()

    const section = within(editor).getByLabelText('Section')
    await userEvent.clear(section)
    await userEvent.type(section, 'W99X1')
    await userEvent.click(within(editor).getByRole('button', { name: 'Save changes' }))
    expect(await within(editor).findByText('Not in section data')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: 'W99X1, member 1. Show on drawing' }).closest('tr')!
    expect(within(row).getByText(/Not in section data/)).toBeInTheDocument()
  })
})

describe('Project section data', () => {
  it('shows which version a project uses', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'Section data' })
    expect(within(card).getByText('AISC Shapes Database v16.0')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  it('explains when no section data is approved', async () => {
    mockProjects.withoutSectionData()
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'Section data' })
    expect(within(card).getByText(/No approved section data yet/)).toBeInTheDocument()
  })
})

describe('Section data administration', () => {
  it('lists versions, approves a draft and looks up a section', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/admin/sections')
    const table = await screen.findByRole('table', { name: 'Imported section data versions' })
    const draft = within(table).getByText('AISC Shapes Database v16.1').closest('tr')!
    expect(within(draft).getByText('Imported, not approved')).toBeInTheDocument()
    await userEvent.click(within(draft).getByRole('button', { name: 'Approve' }))
    const dialog = await screen.findByRole('dialog', { name: /Approve AISC Shapes Database v16.1/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve and make default' }))
    expect(await screen.findByText('Section data approved and set as default')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Section'), 'W12')
    const found = await screen.findByRole('table', { name: 'Matching sections' })
    expect(within(found).getByText('W12X26')).toBeInTheDocument()
    expect(within(found).getByText('38.692')).toBeInTheDocument()
  })

  it('is only for administrators', async () => {
    mockBackend.startSession(OWNER)
    renderApp('/admin/sections')
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument()
  })
})

describe('Changing a project’s section data', () => {
  it('lets the owner pick another approved version; members are matched again', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'Section data' })
    await userEvent.click(within(card).getByRole('button', { name: 'Change' }))
    const select = await within(card).findByLabelText('Use section data')
    expect(within(card).getByRole('button', { name: 'Use this version' })).toBeDisabled() // same version
    await userEvent.selectOptions(select, 'ds-0')
    await userEvent.click(within(card).getByRole('button', { name: 'Use this version' }))
    expect(await screen.findByText('Section data changed; members re-matched')).toBeInTheDocument()
    expect(await within(card).findByText('AISC Shapes Database v15.0')).toBeInTheDocument()
  })
})

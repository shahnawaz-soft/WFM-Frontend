import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

// PDF.js needs a real canvas. The stand-in renders nothing but reports a viewport with the
// same contract as PDF.js (PDF points, y up → CSS pixels, y down) so overlays can be tested.
vi.mock('./pdf', () => ({ loadPdf: async () => ({ numPages: 3 }) }))
vi.mock('./PdfPageCanvas', async () => {
  const { useEffect } = await import('react')
  return {
    PdfPageCanvas: ({
      pageNumber,
      zoom,
      label,
      onViewport,
    }: {
      pageNumber: number
      zoom: number
      label: string
      onViewport?: (vp: unknown) => void
    }) => {
      useEffect(() => {
        onViewport?.({
          scale: zoom,
          width: 2384 * zoom,
          height: 1684 * zoom,
          convertToViewportRectangle: ([l, b, r, t]: number[]) => [l! * zoom, (1684 - b!) * zoom, r! * zoom, (1684 - t!) * zoom],
          convertToViewportPoint: (x: number, y: number) => [x * zoom, (1684 - y) * zoom],
        })
      }, [zoom, onViewport])
      return (
        <div role="img" aria-label={label} data-zoom={zoom}>
          rendered page {pageNumber}
        </div>
      )
    },
  }
})

const OWNER = 'estimator@steelo.test'

async function openViewer(pageNumber = 1, role: 'owner' | 'viewer' = 'owner') {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, {
    'viewer@steelo.test': 'viewer',
  })
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
  mockBackend.startSession(role === 'owner' ? OWNER : 'viewer@steelo.test')
  const page = mockDrawings.sets[0]!.pages[pageNumber - 1]!
  const view = renderApp(`/projects/${project.id}/pages/${page.id}`)
  await screen.findByRole('heading', {
    level: 1,
    name: new RegExp(`^Page ${pageNumber} of 3`),
  })
  return { project, page, ...view }
}

const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const shapes = (container: HTMLElement) => [...container.querySelectorAll<SVGRectElement>('.member-overlay rect')]

/** Process page 1 from the Page tab, then return to Quantities. */
async function runPlan() {
  await userEvent.click(tab('Page'))
  const panel = screen.getByRole('tabpanel')
  await userEvent.click(within(panel).getByRole('button', { name: 'Run Plan' }))
  expect(await within(panel).findByText('Completed')).toBeInTheDocument()
  await userEvent.click(tab('Quantities'))
  return screen.findByRole('table', { name: /Detected members/ })
}

describe('Page workspace', () => {
  it('downloads the drawing without waiting for the page strip', async () => {
    let downloadStarted = false
    let releaseStrip = () => {}
    const stripHeld = new Promise<void>((resolve) => (releaseStrip = resolve))
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith('/file/')) downloadStarted = true
    })
    onTestFinished(() => {
      releaseStrip()
      server.events.removeAllListeners()
    })
    server.use(
      http.get('*/api/v1/drawing-sets/:id/pages/', async () => {
        await stripHeld // then falls through to the default handler
      }),
    )
    await openViewer()
    await waitFor(() => expect(downloadStarted).toBe(true))
  })

  it('opens from a page thumbnail', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
    renderApp(`/projects/${project.id}`)
    await userEvent.click(await screen.findByRole('link', { name: 'Open page 2 of GA.pdf' }))
    expect(await screen.findByRole('heading', { level: 1, name: /^Page 2 of 3/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: 'Drawing: page 2 of GA.pdf' })).toBeInTheDocument()
  })

  it('moves between pages with Previous/Next and the page strip, keeping the zoom', async () => {
    await openViewer(1)
    expect(screen.getByRole('button', { name: '← Previous' })).toBeDisabled()
    await userEvent.click(await screen.findByRole('button', { name: '100%' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next →' }))
    expect(screen.queryByText('Opening page…')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /^Page 2 of 3/ })).toBeInTheDocument()
    expect(await screen.findByRole('img', { name: /Drawing: page 2/ })).toHaveAttribute('data-zoom', '1')

    const strip = screen.getByRole('navigation', {
      name: 'Pages in this drawing set',
    })
    expect(within(strip).getByRole('button', { name: /^Page 2/ })).toHaveAttribute('aria-current', 'page')
    await userEvent.click(within(strip).getByRole('button', { name: /^Page 3/ }))
    expect(await screen.findByRole('heading', { level: 1, name: /^Page 3 of 3/ })).toBeInTheDocument()
  })

  it('zooms in and out', async () => {
    await openViewer()
    await userEvent.click(await screen.findByRole('button', { name: '100%' }))
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    await waitFor(() => expect(screen.getByRole('img', { name: /Drawing/ })).toHaveAttribute('data-zoom', '1.25'))
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    await waitFor(() => expect(screen.getByRole('img', { name: /Drawing/ })).toHaveAttribute('data-zoom', '0.75'))
  })

  it('says why pages cannot be run when the project is finalised', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
    Object.assign(mockProjects.all.find((p) => p.id === project.id)!, { status: 'finalized', finalized_at: new Date().toISOString() })
    renderApp(`/projects/${project.id}/pages/${mockDrawings.sets[0]!.pages[0]!.id}`)
    await screen.findByRole('heading', { level: 1, name: /^Page 1 of 3/ })
    expect(screen.getByText(/The project is finalised: reopen it on the project page to run pages/)).toBeInTheDocument()
    await userEvent.click(tab('Page'))
    const panel = screen.getByRole('tabpanel')
    const notice = within(panel).getByText((_, el) => !!el?.classList.contains('notice') && /This project is finalised/.test(el.textContent ?? ''))
    expect(within(notice).getByRole('link', { name: 'Reopen it on the project page' })).toHaveAttribute('href', `/projects/${project.id}`)
    expect(within(panel).queryByRole('button', { name: 'Run Plan' })).not.toBeInTheDocument()
  })

  it('outlines every detected member and lists it in Quantities', async () => {
    const { container } = await openViewer()
    const table = await runPlan()
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).getAllByRole('cell')[0]!.textContent)).toEqual(['W12X26', 'W12X26', 'HSS6X6X1/4'])
    expect(within(rows[0]!).getByText('Not measured')).toHaveClass('visually-hidden') // shown as —
    expect(within(rows[2]!).getByText('Unsupported type · Length not measured')).toBeInTheDocument()
    await waitFor(() => expect(shapes(container)).toHaveLength(3))
    expect(shapes(container).map((s) => s.dataset.kind)).toEqual(['low', 'detected', 'unsupported'])
    // The measured member shows its length and no length warning; the others explain why not.
    expect(within(rows[1]!).getByText('33\'-4"')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Length not measured')).toBeInTheDocument()
    // Legend explains the line styles in words.
    const legend = screen.getByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Detected')).toBeInTheDocument()
    expect(within(legend).getByText('Low confidence (1)')).toBeInTheDocument()
    expect(within(legend).getByText('Unsupported type')).toBeInTheDocument()
  })

  it('links the list and the drawing in both directions', async () => {
    const { container } = await openViewer()
    const table = await runPlan()
    await waitFor(() => expect(shapes(container)).toHaveLength(3))

    // List → drawing: highlights the outline and zooms in to it.
    const second = within(table).getByRole('button', {
      name: 'W12X26, member 2. Show on drawing',
    })
    await userEvent.click(second)
    expect(second).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(shapes(container)[1]).toHaveAttribute('data-selected', 'true'))
    expect(screen.getByRole('img', { name: /Drawing/ })).toHaveAttribute('data-zoom', '1.5')
    // Its measured span (support centre to support centre) is drawn.
    const span = container.querySelector('.member-span line')!
    expect([span.getAttribute('x1'), span.getAttribute('x2')]).toEqual(['225', '675'])

    // Drawing → list: selects the row (and opens Quantities if another tab was showing).
    await userEvent.click(tab('Flags'))
    await userEvent.click(shapes(container)[2]!)
    const hss = await screen.findByRole('button', {
      name: 'HSS6X6X1/4, member 3. Show on drawing',
    })
    expect(hss).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'W12X26, member 2. Show on drawing' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('filters by section type and can hide the outlines', async () => {
    const { container } = await openViewer()
    const table = await runPlan()
    const tabs = screen.getByRole('group', { name: 'Show section types' })
    await userEvent.click(within(tabs).getByRole('button', { name: /^HSS/ }))
    expect(within(table).getAllByRole('row')).toHaveLength(2) // header + 1
    await waitFor(() => expect(shapes(container)).toHaveLength(1))

    await userEvent.click(screen.getByRole('checkbox', { name: 'Labels' }))
    expect(shapes(container)).toHaveLength(0)
  })

  it('groups quantities by section', async () => {
    await openViewer()
    await runPlan()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Group by section' }))
    const grouped = screen.getByRole('table', {
      name: 'Members grouped by section',
    })
    const rows = within(grouped)
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent)
    expect(rows).toEqual(['W12X262', 'HSS6X6X1/41'])
  })

  it('lists flags and the scale', async () => {
    await openViewer()
    await runPlan()
    await userEvent.click(tab('Flags'))
    const flags = screen.getByRole('list', { name: 'Flags on this page' })
    expect(within(flags).getByText(/lengths are not measured yet/)).toBeInTheDocument()
    expect(within(flags).getAllByText('Check')).toHaveLength(2)

    await userEvent.click(tab('Scale'))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText(/1\/8" = 1'-0"/)).toBeInTheDocument()
    expect(within(panel).getByText('Confirm')).toBeInTheDocument()
    expect(within(panel).getByText(/3 of 3 printed dimensions measure true at this scale: not enough/)).toBeInTheDocument()
    const spacing = within(panel).getByRole('table', { name: 'Grid spacing, as printed' })
    expect(within(spacing).getByRole('row', { name: /1 – 2 19'-0" Matches/ })).toBeInTheDocument()

    await userEvent.click(tab('Page'))
    expect(within(screen.getByRole('tabpanel')).getByText('Plan')).toBeInTheDocument()
  })

  it('collapses the panel when its tab is chosen again', async () => {
    await openViewer()
    expect(tab('Quantities')).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(tab('Quantities'))
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
    expect(tab('Quantities')).toHaveAttribute('aria-selected', 'false')
  })

  it('viewers can look but not run', async () => {
    await openViewer(1, 'viewer')
    await userEvent.click(tab('Page'))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByText('This page has not been processed yet.')).toBeInTheDocument()
    expect(within(panel).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows a clear message for an unknown page', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    renderApp(`/projects/${project.id}/pages/00000000-0000-0000-0000-000000000000`)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

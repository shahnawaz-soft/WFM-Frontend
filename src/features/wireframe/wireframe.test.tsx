import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { preloadRoutes, renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

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
          convertToPdfPoint: (x: number, y: number) => [x / zoom, 1684 - y / zoom],
        })
      }, [zoom, onViewport])
      return <div role="img" aria-label={label} />
    },
  }
})

beforeAll(() => preloadRoutes('/projects/p/pages/p', '/projects/p/wireframe'))

const OWNER = 'estimator@steelo.test'

async function call(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.json()
}

/** Page 1 processed, reviewed and added. Mock members: W12X26 (no span), W12X26 with a span
 *  from (150, 95) to (450, 95) pt at 1:96, HSS unsupported. */
async function addedPage() {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' })
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

describe('Level set-up', () => {
  it('sets level, elevation and the reference grid point from the page workspace', async () => {
    const { project, page } = await addedPage()
    const { container } = renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const panel = await screen.findByRole('tabpanel')
    expect(within(panel).getByRole('heading', { name: 'Level' })).toBeInTheDocument()
    await userEvent.type(within(panel).getByLabelText('Level'), 'Level 2')
    await userEvent.type(within(panel).getByLabelText('Elevation (top of steel)'), "14'")
    await userEvent.type(within(panel).getByLabelText('Grid label'), 'A/1')
    expect(within(panel).getByText('Not set')).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Pick on the drawing' }))
    expect(screen.getByText(/reference grid intersection/)).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.page-layer')).not.toBeNull())
    fireEvent.click(container.querySelector('.page-layer')!, { clientX: 40, clientY: 400 })
    expect(await within(screen.getByRole('tabpanel')).findByText(/Picked \(not saved yet\)/)).toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Save level' }))
    expect(await screen.findByText('Level saved')).toBeInTheDocument()
    const saved = mockDrawings.sets[0]!.pages[0]!
    expect(saved.level_label).toBe('Level 2')
    expect(saved.elevation_mm).toBe('4267.2')
    expect(saved.reference_point).not.toBeNull()
    expect(container.querySelector('.point-marker text')).toHaveTextContent('A/1')
  })

  it('takes the reference point from a grid intersection found on the plan', async () => {
    const { project, page } = await addedPage()
    const { container } = renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const panel = await screen.findByRole('tabpanel')
    await userEvent.selectOptions(within(panel).getByLabelText('Or choose a grid intersection'), 'A/1')
    expect(within(panel).getByText(/Picked \(not saved yet\) on grid A\/1/)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Grid label')).toHaveValue('A/1')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save level' }))
    expect(await screen.findByText('Level saved')).toBeInTheDocument()
    const saved = mockDrawings.sets[0]!.pages[0]!
    expect([saved.reference_point, saved.reference_label]).toEqual([[150, 95], 'A/1'])
    expect(container.querySelector('.point-marker text')).toHaveTextContent('A/1')
  })

  it('snaps a click near a grid intersection onto it', async () => {
    const { project, page } = await addedPage()
    const { container } = renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const panel = await screen.findByRole('tabpanel')
    await userEvent.click(within(panel).getByRole('button', { name: 'Pick on the drawing' }))
    expect(screen.getByText(/it snaps to the nearest one/)).toBeInTheDocument()
    await waitFor(() => expect(container.querySelector('.page-layer')).not.toBeNull())
    // At the 10% zoom used in tests, (16, 160) on screen is (160, 84) pt: 15 pt from A/1.
    fireEvent.click(container.querySelector('.page-layer')!, { clientX: 16, clientY: 160 })
    expect(await within(screen.getByRole('tabpanel')).findByText(/on grid A\/1 at 150, 95 pt/)).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).getByLabelText('Grid label')).toHaveValue('A/1')
  })

  it('draws the grid lines and can hide them', async () => {
    const { project, page } = await addedPage()
    const { container } = renderApp(`/projects/${project.id}/pages/${page.id}`)
    const toggle = await screen.findByRole('checkbox', { name: /Grids \(2\)/ })
    await waitFor(() => expect(container.querySelectorAll('.grid-overlay line')).toHaveLength(2))
    expect(container.querySelector('.grid-overlay [data-drawn="false"] title')).toHaveTextContent(/Grid A \(only a stub is drawn/)
    await userEvent.click(toggle)
    expect(container.querySelector('.grid-overlay')).toBeNull()
  })

  it('fills the level in from the drawings for the person to save', async () => {
    const { project, page } = await addedPage()
    renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const proposal = await screen.findByRole('note', { name: 'Proposed from the drawings' })
    expect(within(proposal).getByText(/LEVEL 2 · 14'-0" · reference A\/1/)).toBeInTheDocument()
    expect(within(proposal).getByText(/Elevation from page 9: 2ND TOS 14' - 0"/)).toBeInTheDocument()
    await userEvent.click(within(proposal).getByRole('button', { name: 'Use these' }))
    const panel = screen.getByRole('tabpanel')
    expect(within(panel).getByLabelText('Level')).toHaveValue('LEVEL 2')
    expect(within(panel).getByLabelText('Elevation (top of steel)')).toHaveValue("14'-0\"")
    expect(within(panel).getByLabelText('Grid label')).toHaveValue('A/1')
    expect(mockDrawings.sets[0]!.pages[0]!.elevation_mm).toBeNull() // nothing saved yet
    // Filled in, not saved: the box says so instead of offering the same values again.
    expect(within(proposal).queryByRole('button', { name: 'Use these' })).toBeNull()
    expect(proposal).toHaveTextContent('Filled in below: choose Save level to keep them.')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save level' }))
    expect(await screen.findByText('Level saved')).toBeInTheDocument()
    expect(mockDrawings.sets[0]!.pages[0]!.reference_point).toEqual([150, 95])
    expect(await within(proposal).findByText('Already applied')).toBeInTheDocument()

    // Changing a value away from the drawings offers them again.
    await userEvent.clear(within(panel).getByLabelText('Level'))
    await userEvent.type(within(panel).getByLabelText('Level'), 'MEZZANINE')
    expect(within(proposal).getByRole('button', { name: 'Use these' })).toBeInTheDocument()
  })

  it('says what is still needed when the drawings give only part of the set-up', async () => {
    const { project, page } = await addedPage()
    mockDrawings.noElevationProposed(page.id) // as on Structures p.20: no elevation marked
    renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const proposal = await screen.findByRole('note', { name: 'Proposed from the drawings' })
    await userEvent.click(within(proposal).getByRole('button', { name: 'Use these' }))
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Save level' }))
    expect(await within(proposal).findByText('Already applied')).toBeInTheDocument()
    expect(proposal).toHaveTextContent('Still needed: the elevation. The drawings don’t give it: type it below.')
  })

  it('asks nothing of a sheet that is not a plan', async () => {
    const { project, page } = await addedPage()
    mockDrawings.sheetKind(page.id, 'elevation') // as on Structures p.21 (braced frames)
    renderApp(`/projects/${project.id}/wireframe`)
    const row = (await screen.findByRole('link', { name: /Page 1 · GA.pdf/ })).closest('tr')!
    expect(row).toHaveTextContent('Nothing: elevation sheet, its members are not placed in 3D')
    expect(screen.queryByText('Every page is set up')).toBeInTheDocument()
  })

  it('tells the Level tab of a sheet that is not a plan that nothing is needed', async () => {
    const { project, page } = await addedPage()
    mockDrawings.sheetKind(page.id, 'elevation')
    renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    expect(await screen.findByText(/This is not a plan \(elevation sheet\): it needs no level set-up/)).toBeInTheDocument()
    expect(screen.queryByRole('note', { name: 'Proposed from the drawings' })).toBeNull()
  })

  it('applies the proposed levels from the wireframe page', async () => {
    const { project } = await addedPage()
    renderApp(`/projects/${project.id}/wireframe`)
    const card = await screen.findByRole('region', { name: 'Proposed from the drawings' })
    const row = within(card).getByRole('row', { name: /Page 1/ })
    expect(within(row).getByText('2ND TOS 14\' - 0"', { exact: false })).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: 'Apply to 1 page' }))
    expect(await screen.findByText('Levels set from the drawings')).toBeInTheDocument()
    expect(mockDrawings.sets[0]!.pages[0]!.elevation_mm).toBe('4267.2')
    await waitFor(() => expect(within(screen.getByRole('region', { name: 'Proposed from the drawings' })).queryByRole('button', { name: /Apply to/ })).toBeNull())
  })

  it('explains a bad elevation', async () => {
    const { project, page } = await addedPage()
    renderApp(`/projects/${project.id}/pages/${page.id}?tab=level`)
    const panel = await screen.findByRole('tabpanel')
    await userEvent.type(within(panel).getByLabelText('Elevation (top of steel)'), 'high')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save level' }))
    expect(await within(panel).findByText(/feet and inches/)).toBeInTheDocument()
  })
})

describe('Wireframe', () => {
  it('shows what each page still needs before it can be placed', async () => {
    const { project, page } = await addedPage()
    renderApp(`/projects/${project.id}/wireframe`)
    const setup = await screen.findByRole('table', { name: /level set-up/ })
    const row = within(setup).getByRole('link', { name: 'Page 1 · GA.pdf' }).closest('tr')!
    expect(within(row).getByText('elevation, reference grid point')).toBeInTheDocument()
    expect(within(row).getByText('1:96')).toBeInTheDocument()
    expect(row).toHaveTextContent(/1:963elevation/) // three column symbols found (I, square, round)
    expect(within(row).getByRole('link')).toHaveAttribute('href', `/projects/${project.id}/pages/${page.id}?tab=level`)
    expect(screen.getByRole('note')).toHaveTextContent(/starting wireframe, not a detailed model/)
  })

  it('generates a revision, places what it can and lists the rest', async () => {
    const { project, page } = await addedPage()
    await call('PATCH', `/drawing-pages/${page.id}/level/`, {
      level_label: 'Level 2',
      elevation: "14'",
      reference_point: [150, 95],
      reference_label: 'A/1',
    })
    renderApp(`/projects/${project.id}/wireframe`)
    expect(await screen.findByText('Every page is set up')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Generate wireframe' }))

    const revision = await screen.findByRole('region', { name: /Revision 1/ })
    const stats = within(revision).getByLabelText('Wireframe summary')
    expect(within(stats).getByText('Placed').nextSibling).toHaveTextContent('4') // beam + 3 columns
    expect(within(stats).getByText('Columns').nextSibling).toHaveTextContent('3')
    expect(within(stats).getByText('Missing data').nextSibling).toHaveTextContent('1')
    expect(within(stats).getByText('Not in 3D').nextSibling).toHaveTextContent('1')
    expect(within(revision).getByText(/Levels: Level 2 at 14'-0"/)).toBeInTheDocument()
    expect(within(revision).getByRole('img', { name: 'Wireframe view: 1 beams and 3 columns placed' })).toBeInTheDocument()
    expect(within(revision).queryByText(/No columns:/)).not.toBeInTheDocument()

    const elements = within(revision).getByRole('table', { name: 'Wireframe elements' })
    const placed = within(elements).getAllByText('Placed')[0]!.closest('tr')!
    // (450 − 150) pt ÷ 72 × 96 × 25.4 = 10,160 mm = 33'-4"
    expect(placed).toHaveTextContent(`0'-0", 0'-0", 14'-0"`)
    expect(placed).toHaveTextContent(`33'-4", 0'-0", 14'-0"`)
    expect(within(placed).getByRole('link', { name: 'p.1' })).toHaveAttribute('href', expect.stringContaining('?member='))

    // The column symbol at (460, 95): 310 pt right of the reference = 34'-5" at 1:96; 0 → 14 ft.
    const column = within(elements).getAllByText('Size not on plan')[0]!.closest('tr')!
    expect(column).toHaveTextContent(/^Column/)
    expect(column).toHaveTextContent(`34'-5", 0'-0", 0'-0"`)
    expect(column).toHaveTextContent(`34'-5", 0'-0", 14'-0"`)
    expect(column).toHaveTextContent(/Wide-flange column \(I\), drawn about 13.6" × 12.5"/)
    expect(within(elements).getByText(/Round tube column, drawn about 6" diameter/)).toBeInTheDocument()
    expect(within(elements).getByText(/Square tube column, drawn about 5"/)).toBeInTheDocument()

    await userEvent.click(within(revision).getByRole('checkbox', { name: /Only elements that are not placed/ }))
    expect(within(elements).queryByText('Placed')).not.toBeInTheDocument()
    expect(within(elements).getByText('No measured span.')).toBeInTheDocument()
  })

  it('keeps earlier revisions', async () => {
    const { project } = await addedPage()
    renderApp(`/projects/${project.id}/wireframe`)
    await userEvent.click(await screen.findByRole('button', { name: 'Generate wireframe' }))
    await screen.findByRole('region', { name: /Revision 1/ })
    await userEvent.click(screen.getByRole('button', { name: 'Generate again' }))
    expect(await screen.findByRole('region', { name: /Revision 2/ })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Revision'), screen.getByRole('option', { name: /Revision 1/ }))
    expect(await screen.findByRole('region', { name: /Revision 1/ })).toBeInTheDocument()
  })

  it('opens the 3D view full window and leaves it with Escape or the button', async () => {
    const { project } = await addedPage()
    await call('POST', `/projects/${project.id}/wireframes/`)
    renderApp(`/projects/${project.id}/wireframe`)
    const full = await screen.findByRole('button', { name: 'Full screen' })
    await userEvent.click(full)
    const view = full.closest('.wf3d')!
    expect(view).toHaveAttribute('data-expanded')
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toHaveAttribute('aria-pressed', 'true')
    expect(document.body.style.overflow).toBe('hidden')

    await userEvent.keyboard('{Escape}')
    expect(view).not.toHaveAttribute('data-expanded')
    expect(document.body.style.overflow).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    await userEvent.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(view).not.toHaveAttribute('data-expanded')
  })

  it('has one Rotate / Move switch over the view; flat views move', async () => {
    const { project, page } = await addedPage()
    await call('PATCH', `/drawing-pages/${page.id}/level/`, {
      level_label: 'Level 2',
      elevation: "14'",
      reference_point: [150, 95],
      reference_label: 'A/1',
    })
    await call('POST', `/projects/${project.id}/wireframes/`)
    renderApp(`/projects/${project.id}/wireframe`)
    const drag = await screen.findByRole('group', { name: 'Drag to' })
    expect(within(drag).getByRole('button', { name: 'Rotate' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Top' }))
    expect(within(drag).getByRole('button', { name: 'Move' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '3D' }))
    expect(within(drag).getByRole('button', { name: 'Rotate' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows no out-of-date notice right after generating', async () => {
    const { project } = await addedPage()
    await call('POST', `/projects/${project.id}/wireframes/`)
    renderApp(`/projects/${project.id}/wireframe`)
    await screen.findByRole('region', { name: /Revision 1/ })
    expect(screen.queryByRole('note', { name: 'Wireframe out of date' })).not.toBeInTheDocument()
  })

  it('names the pages whose set-up changed since generating', async () => {
    const { project, page } = await addedPage()
    await call('POST', `/projects/${project.id}/wireframes/`)
    await call('PATCH', `/drawing-pages/${page.id}/level/`, { level_label: 'Level 3', elevation: "28'" })
    renderApp(`/projects/${project.id}/wireframe`)
    const notice = await screen.findByRole('note', { name: 'Wireframe out of date' })
    expect(notice).toHaveTextContent('level set-up changed on 1 page (page 1 · GA.pdf)')
    expect(notice).toHaveTextContent('Choose Generate again')
  })

  it.each([
    ['timed_out', 'Timed out', 'Generating the wireframe took too long and was stopped. Nothing was lost. Generate it again.'],
    ['generation_error', 'Failed', 'Generating the wireframe failed unexpectedly. Nothing was lost. Generate it again.'],
  ])('says why a generation failed (%s)', async (code, badge, message) => {
    const { project } = await addedPage()
    const generated = await call('POST', `/projects/${project.id}/wireframes/`)
    server.use(
      http.get('*/api/v1/projects/:id/wireframes/', () =>
        HttpResponse.json([{ ...generated, status: 'failed', error_code: code, error_message: message }]),
      ),
    )
    renderApp(`/projects/${project.id}/wireframe`)
    const revision = await screen.findByRole('region', { name: /Revision 1/ })
    expect(within(revision).getByRole('heading', { name: new RegExp(`Revision 1 ${badge}`) })).toBeInTheDocument()
    expect(within(revision).getByText(message)).toBeInTheDocument()
  })

  it('needs pages in the project first', async () => {
    const project = mockProjects.create('Empty', OWNER)
    mockBackend.startSession(OWNER)
    renderApp(`/projects/${project.id}/wireframe`)
    expect(await screen.findByText(/No pages in the project yet/)).toBeInTheDocument()
    const generate = screen.getByRole('button', { name: 'Generate wireframe' })
    expect(generate).toBeDisabled()
    // Why, next to the button (and read with it)
    expect(generate).toHaveAccessibleDescription(/Built from pages added to the project/)
  })

  it('viewers can look but not generate', async () => {
    const { project } = await addedPage()
    mockBackend.startSession('viewer@steelo.test')
    renderApp(`/projects/${project.id}/wireframe`)
    await screen.findByRole('table', { name: /level set-up/ })
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument()
  })

  it('is linked from the project review card', async () => {
    const { project } = await addedPage()
    await call('POST', `/projects/${project.id}/wireframes/`)
    renderApp(`/projects/${project.id}`)
    const card = await screen.findByRole('region', { name: 'Project review' })
    expect(await within(card).findByText('Draft')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open wireframe' })).toHaveAttribute('href', `/projects/${project.id}/wireframe`)
  })
})

describe('Column symbols on the drawing', () => {
  it('outlines each column found on the plan and lists it in the legend', async () => {
    const { project, page } = await addedPage()
    const { container } = renderApp(`/projects/${project.id}/pages/${page.id}`)
    const legend = await screen.findByRole('list', { name: 'Legend' })
    expect(within(legend).getByText('Column (3)')).toHaveAttribute('title', '1 I, 1 square, 1 round')
    await waitFor(() => expect(container.querySelectorAll('.column-overlay rect')).toHaveLength(2))
    expect(container.querySelectorAll('.column-overlay circle')).toHaveLength(1) // the round tube
    const titles = [...container.querySelectorAll('.column-overlay title')].map((t) => t.textContent)
    expect(titles).toEqual([
      'Wide-flange column (I), drawn about 13.6" × 12.5"',
      'Square tube column, drawn about 5"',
      'Round tube column, drawn about 6" diameter',
    ])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Labels' }))
    expect(container.querySelectorAll('.column-overlay rect, .column-overlay circle')).toHaveLength(0)
  })
})

describe('Editing the wireframe', () => {
  async function openDraft() {
    const setup = await addedPage()
    await call('PATCH', `/drawing-pages/${setup.page.id}/level/`, { level_label: 'Level 2', elevation: "14'", reference_point: [150, 95] })
    await call('POST', `/projects/${setup.project.id}/wireframes/`)
    return setup
  }
  const table = () => screen.findByRole('table', { name: 'Wireframe elements' })
  const stat = (label: string) => within(screen.getByLabelText('Wireframe summary')).getByText(label).nextSibling

  it('moves an element by editing its ends in feet-inches', async () => {
    const { project } = await openDraft()
    renderApp(`/projects/${project.id}/wireframe`)
    const placed = within(await table()).getAllByText('Placed')[0]!.closest('tr')!
    await userEvent.click(placed)
    const panel = screen.getByRole('region', { name: /^Beam W12X26/ })
    expect(within(panel).getByLabelText('End x')).toHaveValue(`33'-4"`)
    await userEvent.clear(within(panel).getByLabelText('End x'))
    await userEvent.type(within(panel).getByLabelText('End x'), "30'")
    await userEvent.type(within(panel).getByLabelText('Reason / note'), 'Grid 3')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByText('Changes saved')).toBeInTheDocument()
    await waitFor(() => expect(stat('Edited')).toHaveTextContent('1'))
    expect(within(await table()).getByText(`30'-0", 0'-0", 14'-0"`)).toBeInTheDocument()
  })

  it('places an element that could not be placed', async () => {
    const { project } = await openDraft()
    renderApp(`/projects/${project.id}/wireframe`)
    await userEvent.click(within(await table()).getByText('No measured span.').closest('tr')!)
    const panel = screen.getByRole('region', { name: /^Beam W12X26/ })
    for (const [label, value] of [['Start x', '0'], ['Start y', "10'"], ['Start z', "14'"], ['End x', "20'"], ['End y', "10'"], ['End z', "14'"]]) {
      await userEvent.type(within(panel).getByLabelText(label!), value!)
    }
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(stat('Missing data')).toHaveTextContent('0'))
  })

  it('adds and removes elements', async () => {
    const { project } = await openDraft()
    renderApp(`/projects/${project.id}/wireframe`)
    await table()
    await userEvent.click(screen.getByRole('button', { name: '+ Add element' }))
    const form = screen.getByRole('region', { name: 'Add an element' })
    await userEvent.type(within(form).getByLabelText('Section'), 'w14x90')
    for (const [label, value] of [['Start x', '0'], ['Start y', '0'], ['Start z', '0'], ['End x', '0'], ['End y', '0'], ['End z', "14'"]]) {
      await userEvent.type(within(form).getByLabelText(label!), value!)
    }
    await userEvent.click(within(form).getByRole('button', { name: 'Add element' }))
    const panel = await screen.findByRole('region', { name: /^Column W14X90/ })
    await waitFor(() => expect(stat('Added')).toHaveTextContent('1'))

    await userEvent.click(within(panel).getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Remove this element?' })).getByRole('button', { name: 'Remove element' }))
    expect(await screen.findByText('Element removed')).toBeInTheDocument()
    await waitFor(() => expect(stat('Removed')).toHaveTextContent('1'))
    expect(within(await table()).queryByText('W14X90')).not.toBeInTheDocument()
  })

  it('saves as reviewed (frozen, with the work left) and continues in a copy', async () => {
    const { project } = await openDraft()
    renderApp(`/projects/${project.id}/wireframe`)
    await table()
    await userEvent.click(screen.getByRole('button', { name: 'Save as reviewed…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Save revision 1 as reviewed?' })
    expect(within(dialog).getByText('1 elements not placed')).toBeInTheDocument()
    expect(within(dialog).getByText('3 columns without a size')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save as reviewed' }))
    expect(await screen.findByText(/Saved as reviewed and frozen\. Remaining manual work: 1 not placed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add element' })).not.toBeInTheDocument()

    await userEvent.click(within(await table()).getAllByText('Placed')[0]!.closest('tr')!)
    expect(within(screen.getByRole('region', { name: /^Beam W12X26/ })).getByLabelText('End x')).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Copy to a new revision' }))
    expect(await screen.findByRole('region', { name: /Revision 2/ })).toBeInTheDocument()
    expect(await screen.findByText(/Started from revision 1/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Add element' })).toBeInTheDocument()
  })

  it('opens at a member linked from the plan', async () => {
    const { project, page } = await openDraft()
    const members = await call('GET', `/drawing-pages/${page.id}/members/`)
    const measured = members.find((m: { geometry: unknown[] }) => m.geometry.length === 2)
    renderApp(`/projects/${project.id}/wireframe?member=${measured.id}`)
    expect(await screen.findByRole('region', { name: /^Beam W12X26/ })).toBeInTheDocument()
  })
})

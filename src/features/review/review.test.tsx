import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { preloadRoutes, renderApp } from '../../test/renderApp'
import { server } from '../../test/server'
import { similarSearchPolling } from '../viewer/useSetSimilarSearch'

vi.mock('../viewer/pdf', () => ({ loadPdf: async () => ({ numPages: 3 }) }))
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
          convertToPdfPoint: (x: number, y: number) => [x / zoom + 500, 1684 - y / zoom - 400],
        })
      }, [zoom, onViewport])
      return <div role="img" aria-label={label} data-zoom={zoom} />
    },
  }
})

beforeAll(() => preloadRoutes('/projects/p/pages/p'))

const OWNER = 'estimator@steelo.test'

async function openProcessedPage(role: 'owner' | 'viewer' = 'owner') {
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  const project = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' })
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:1'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  if (role === 'viewer') mockBackend.startSession('viewer@steelo.test')
  const view = renderApp(`/projects/${project.id}/pages/${page.id}`)
  await screen.findByRole('heading', { level: 1, name: /^Page 1 of 1/ })
  // Process the page (as the owner) through the Page tool.
  if (role === 'owner') {
    await userEvent.click(screen.getByRole('tab', { name: /^Page/ }))
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Run Plan' }))
    await within(screen.getByRole('tabpanel')).findByText('Completed')
    await userEvent.click(screen.getByRole('tab', { name: /^Quantities/ }))
  }
  return { page, project, ...view }
}

const memberButton = (n: number, name = 'W12X26') => screen.getByRole('button', { name: `${name}, member ${n}. Show on drawing` })
const editor = () => screen.getByRole('region', { name: /member \d+$/ })

async function select(n: number, name = 'W12X26') {
  await screen.findByRole('table', { name: /Detected members/ })
  await userEvent.click(screen.getByRole('button', { name: `Edit ${name}, member ${n}` }))
  return editor()
}

describe('Correcting members', () => {
  it('saves a correction, keeps the original visible and records history', async () => {
    await openProcessedPage()
    const panel = await select(1)
    expect(within(panel).getByText(/Detected as W12X26, 60% confidence/)).toBeInTheDocument()

    const section = within(panel).getByLabelText('Section')
    await userEvent.clear(section)
    await userEvent.type(section, 'W12X30')
    await userEvent.type(within(panel).getByLabelText('Length'), "24'-3\"")
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))

    expect(await within(panel).findByText('Changes saved')).toBeInTheDocument()
    expect(within(panel).getByText('Corrected')).toBeInTheDocument()
    const row = memberButton(1, 'W12X30').closest('tr')!
    expect(within(row).getByText("24'-3\"")).toBeInTheDocument()
    expect(within(row).getByText(/corrected/)).toBeInTheDocument()

    await userEvent.click(within(panel).getByRole('button', { name: 'Show history' }))
    const history = await within(panel).findByRole('list', { name: 'Member history' })
    expect(within(history).getByText('Corrected')).toBeInTheDocument()
  })

  it('shows the studs and camber printed with the label, in the list and the editor', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    const row = memberButton(2).closest('tr')!
    expect(within(row).getByTitle('Studs and camber, as printed with the label')).toHaveTextContent('(12) C=3/4"')
    expect(within(memberButton(1).closest('tr')!).queryByTitle(/Studs and camber/)).not.toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Edit W12X26, member 2' }))
    expect(within(editor()).getByLabelText('Studs')).toHaveValue('12')
    expect(within(editor()).getByLabelText('Camber')).toHaveValue('3/4"')
  })

  it('corrects the studs and camber', async () => {
    await openProcessedPage()
    const panel = await select(2)
    await userEvent.clear(within(panel).getByLabelText('Studs'))
    await userEvent.type(within(panel).getByLabelText('Studs'), 'many')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    expect(await within(panel).findByText(/Type the number of studs/)).toBeInTheDocument()

    await userEvent.clear(within(panel).getByLabelText('Studs'))
    await userEvent.type(within(panel).getByLabelText('Studs'), '36, 4, 4')
    await userEvent.clear(within(panel).getByLabelText('Camber'))
    await userEvent.type(within(panel).getByLabelText('Camber'), '1 1/4"')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    expect(await within(panel).findByText('Changes saved')).toBeInTheDocument()
    const row = memberButton(2).closest('tr')!
    expect(within(row).getByTitle('Studs and camber, as printed with the label')).toHaveTextContent('(36, 4, 4) C=1 1/4"')
  })

  it('types a member as a column, and explains where its length and weight come from', async () => {
    await openProcessedPage()
    const panel = await select(1)
    expect(within(panel).getByText('Weight: needs a length')).toBeInTheDocument()
    await userEvent.selectOptions(within(panel).getByLabelText('Type'), 'column')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    expect(await within(panel).findByText('Changes saved')).toBeInTheDocument()

    expect(within(panel).getByText('Weight: once its height is known')).toBeInTheDocument()
    expect(within(panel).getByLabelText('Length')).toHaveAttribute('placeholder', 'From levels')
    expect(within(panel).getByText(/length is its storey height/)).toBeInTheDocument()
    const row = memberButton(1).closest('tr')!
    expect(within(row).getByText('From levels')).toBeInTheDocument()
    expect(within(panel).getByRole('group', { name: 'Review decision' })).toHaveClass('member-editor__decisions')
  })

  it('explains an unreadable length next to the field', async () => {
    await openProcessedPage()
    const panel = await select(1)
    await userEvent.type(within(panel).getByLabelText('Length'), 'about ten feet')
    await userEvent.click(within(panel).getByRole('button', { name: 'Save changes' }))
    expect(await within(panel).findByText(/Use feet and inches/)).toBeInTheDocument()
    expect(within(panel).getByLabelText('Length')).toHaveAttribute('aria-invalid', 'true')
  })

  it('requires a reason to reject, then shows the decision on the list and drawing', async () => {
    const { container } = await openProcessedPage()
    const panel = await select(2)
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject' }))
    expect(await within(panel).findByText('Say why this member is rejected.')).toBeInTheDocument()

    await userEvent.type(within(panel).getByLabelText('Reason / note'), 'Duplicate label')
    await userEvent.click(within(panel).getByRole('button', { name: 'Reject' }))
    expect(await within(panel).findByText('Marked rejected')).toBeInTheDocument()
    expect(within(memberButton(2).closest('tr')!).getByText('Rejected')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.member-overlay rect')[1]).toHaveAttribute('data-kind', 'rejected'))
  })
})

describe('Page review', () => {
  it('accepts the rest, requires a decision on unsupported types, then locks the page', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    expect(screen.getByRole('button', { name: 'Mark page reviewed' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Accept all remaining (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Accept 2 remaining members?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept all remaining' }))
    expect(await screen.findByText('Accepted 2 members')).toBeInTheDocument()
    await screen.findByText(/1 to review/)

    const panel = await select(3, 'HSS6X6X1/4')
    await userEvent.click(within(panel).getByRole('button', { name: 'Unsupported' }))
    await within(panel).findByText('Marked unsupported')

    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark page reviewed' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Mark page reviewed' }))
    expect(await screen.findByText(/Page review complete/)).toBeInTheDocument()

    const locked = await select(1)
    expect(within(locked).getByText(/Reopen the review to change members/)).toBeInTheDocument()
    expect(within(locked).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Reopen review' }))
    expect(await screen.findByRole('button', { name: 'Mark page reviewed' })).toBeInTheDocument()
  })

  it('asks before re-running a page that has review work', async () => {
    await openProcessedPage()
    const panel = await select(1)
    await userEvent.click(within(panel).getByRole('button', { name: 'Accept' }))
    await within(panel).findByText('Marked accepted')

    await userEvent.click(screen.getByRole('tab', { name: /^Page/ }))
    await userEvent.click(within(screen.getByRole('tabpanel')).getByRole('button', { name: 'Run again' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Run page 1 again?' })).getByRole('button', { name: 'Run again' }))
    const warning = await screen.findByRole('dialog', { name: 'This page has review work' })
    expect(within(warning).getByText(/replaces the extracted members and their review decisions/)).toBeInTheDocument()
    await userEvent.click(within(warning).getByRole('button', { name: 'Run again and replace review' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Choosing several members', () => {
  const tickBox = (n: number, name = 'W12X26') => screen.getByRole('checkbox', { name: `Choose ${name}, member ${n}` })

  it('accepts the chosen members together', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(tickBox(1))
    await userEvent.click(tickBox(2))
    const bar = screen.getByRole('group', { name: 'Chosen members' })
    expect(within(bar).getByText('2 members chosen')).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: 'Accept' }))
    expect(await screen.findByText('Accepted 2 members')).toBeInTheDocument()
    const rows = within(screen.getByRole('table', { name: /Detected members/ })).getAllByRole('row').slice(1)
    expect(rows.map((r) => within(r).queryByText('Accepted') !== null)).toEqual([true, true, false])
    expect(screen.queryByRole('group', { name: 'Chosen members' })).not.toBeInTheDocument() // cleared
  })

  it('rejects the chosen members with one reason', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Choose every member listed' }))
    const bar = screen.getByRole('group', { name: 'Chosen members' })
    expect(within(bar).getByText('3 members chosen')).toBeInTheDocument()
    await userEvent.click(within(bar).getByRole('button', { name: 'Reject…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reject 3 members?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 3 members' }))
    expect(await within(dialog).findByText(/Say why/)).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Not steel')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject 3 members' }))
    expect(await screen.findByText('Rejected 3 members')).toBeInTheDocument()
  })

  it('edits only the fields filled in, for every chosen member', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(tickBox(1))
    await userEvent.click(tickBox(2))
    await userEvent.click(within(screen.getByRole('group', { name: 'Chosen members' })).getByRole('button', { name: 'Edit…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 members' })
    const save = within(dialog).getByRole('button', { name: 'Save 2 members' })
    expect(save).toBeDisabled() // nothing to change yet
    await userEvent.type(within(dialog).getByLabelText('Length'), 'long')
    await userEvent.click(save)
    expect(await within(dialog).findByText(/Use feet and inches/)).toBeInTheDocument()
    await userEvent.clear(within(dialog).getByLabelText('Length'))
    await userEvent.type(within(dialog).getByLabelText('Section'), 'w14x22')
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'column')
    await userEvent.type(within(dialog).getByLabelText('Studs'), '20')
    await userEvent.type(within(dialog).getByLabelText('Camber'), '1/2"')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Also accept them' }))
    await userEvent.click(save)
    expect(await screen.findByText('2 members changed and accepted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'W14X22, member 1. Show on drawing' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'W14X22, member 2. Show on drawing' })).toBeInTheDocument()
    expect(within(memberButton(1, 'W14X22').closest('tr')!).getByTitle(/Studs and camber/)).toHaveTextContent('(20) C=1/2"')
    expect(screen.getByRole('button', { name: 'HSS6X6X1/4, member 3. Show on drawing' })).toBeInTheDocument()
  })

  it('offers no tick boxes to viewers', async () => {
    await openProcessedPage('viewer')
    expect(screen.queryByRole('checkbox', { name: /^Choose/ })).not.toBeInTheDocument()
  })
})

describe('Adding a missed member', () => {
  it('places it on the drawing and adds it to the list', async () => {
    const { container } = await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: '+ Add member' }))
    expect(screen.getByText('Click the drawing where the member is · Esc to cancel')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('img', { name: /Drawing/ }))
    const form = await screen.findByRole('region', { name: 'Add a missed member' })
    expect(within(form).getByText(/Location picked on the drawing/)).toBeInTheDocument()
    await userEvent.type(within(form).getByLabelText('Section'), 'w10x12')
    await userEvent.type(within(form).getByLabelText('Length'), "12'-6\"")
    await userEvent.click(within(form).getByRole('button', { name: 'Add member' }))

    const row = (await screen.findByRole('button', { name: 'W10X12, member 4. Show on drawing' })).closest('tr')!
    expect(within(row).getByText('Manual')).toBeInTheDocument()
    expect(within(row).getByText('Accepted')).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.member-overlay rect')).toHaveLength(4))
  })

  it('Esc cancels placing', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: '+ Add member' }))
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText(/Click the drawing where the member is/)).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Add a missed member' })).toHaveTextContent('No location on the drawing yet')
  })
})

describe('Pens', () => {
  it('reads the pen of a line clicked and sets it as the project’s member pen', async () => {
    const { project } = await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: 'Pens' }))
    expect(screen.getByText(/Click a line on the drawing to see its pen/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('img', { name: /Drawing/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Pen of this line' })
    expect(await within(dialog).findByText(/42 lines drawn with it on this page/)).toBeInTheDocument()
    expect(within(dialog).getByText('1.08 pt · #000000')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Member lines are this pen' }))
    expect(await screen.findByText(/Pens saved: 1 page running again/)).toBeInTheDocument()
    expect(mockProjects.all.find((p) => p.id === project.id)!.pens).toEqual({ member: [{ width: 1.08, colour: '#000000' }], grid: [] })
  })
})

describe('Page area', () => {
  /** Drag a box on the drawing from one PDF point to another (the stand-in viewport's mapping). */
  async function dragBox([x1, y1]: [number, number], [x2, y2]: [number, number]) {
    const drawing = screen.getByRole('img', { name: /Drawing/ })
    const zoom = Number(drawing.dataset.zoom)
    const screenPoint = (x: number, y: number) => ({ clientX: (x - 500) * zoom, clientY: (1684 - 400 - y) * zoom })
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: drawing, coords: screenPoint(x1, y1) },
      { target: drawing, coords: screenPoint(x2, y2) },
      { keys: '[/MouseLeft]', target: drawing, coords: screenPoint(x2, y2) },
    ])
  }

  it('counts only the members inside the box drawn, and clears it again', async () => {
    const { container } = await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: 'Area' }))
    expect(screen.getByText(/around the part of the sheet to count/)).toBeInTheDocument()
    await dragBox([100, 200], [200, 50]) // around members 1 and 2 (labels at x 120, 170)
    const confirm = await screen.findByRole('dialog', { name: 'Count only inside this area?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Save area and run again' }))
    expect(await screen.findByText('Area saved: the page is running again')).toBeInTheDocument()

    const page = mockDrawings.sets[0]!.pages[0]!
    expect(page.area).toEqual([100, 50, 200, 200])
    await waitFor(() => expect(container.querySelector('.area-overlay')).not.toBeNull())
    const hss = memberButton(3, 'HSS6X6X1/4').closest('tr')!
    await waitFor(() => expect(within(hss).getByText('Rejected')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: 'Clear area' }))
    const clear = await screen.findByRole('dialog', { name: 'Count the whole sheet again?' })
    await userEvent.click(within(clear).getByRole('button', { name: 'Clear area and run again' }))
    await waitFor(() => expect(container.querySelector('.area-overlay')).toBeNull())
    expect(page.area).toBeNull()
  })

  it('asks before replacing review work', async () => {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: /^Accept all remaining \(/ }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: /^Accept \d+ remaining/ })).getByRole('button', { name: 'Accept all remaining' }))
    await screen.findByText(/^Accepted \d+ members?/)
    await userEvent.click(screen.getByRole('button', { name: 'Area' }))
    await dragBox([100, 200], [200, 50])
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Count only inside this area?' })).getByRole('button', { name: 'Save area and run again' }))
    const warning = await screen.findByRole('dialog', { name: 'This page has review work' })
    await userEvent.click(within(warning).getByRole('button', { name: 'Run again and replace review' }))
    await waitFor(() => expect(mockDrawings.sets[0]!.pages[0]!.area).toEqual([100, 50, 200, 200]))
  })

  it('offers no area to viewers', async () => {
    await openProcessedPage('viewer')
    expect(screen.queryByRole('button', { name: 'Area' })).not.toBeInTheDocument()
  })
})

describe('Find similar', () => {
  beforeEach(() => {
    similarSearchPolling.intervalMs = 20 // the job is polled every 2 s in the app
  })

  /** Counts requests by path while the test runs. */
  function countRequests() {
    const seen: string[] = []
    server.events.on('request:start', ({ request }) => seen.push(`${request.method} ${new URL(request.url).pathname}`))
    onTestFinished(() => server.events.removeAllListeners())
    return (pattern: RegExp) => seen.filter((r) => pattern.test(r)).length
  }

  async function findOnPage() {
    await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: 'Find similar' }))
    expect(screen.getByText(/around a column symbol Steelo missed/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('img', { name: /Drawing/ }))
    expect(await screen.findByText(/3 columns added on this page/)).toBeInTheDocument()
  }

  it('adds the columns drawn like the one clicked, then searches the whole set as a job', async () => {
    const count = countRequests()
    await findOnPage()
    await userEvent.click(screen.getByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByText(/Searching every plan of this set/)).toBeInTheDocument()
    expect(await screen.findByText(/5 columns added on 1 page\./)).toBeInTheDocument()
    expect(count(/^POST .*\/find-similar-columns\/jobs\/$/)).toBe(1)
    expect(count(/^POST .*\/find-similar-columns\/$/)).toBe(1) // the page search only: no synchronous set search
    expect(count(/^GET .*\/similar-columns-jobs\/[^/]+\/$/)).toBeGreaterThanOrEqual(2) // polled until done
    // Polling stops once the job has ended.
    const polls = count(/^GET .*\/similar-columns-jobs\//)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(count(/^GET .*\/similar-columns-jobs\//)).toBe(polls)
  })

  it('refreshes the pages when the job ends, without downloading the drawing again', async () => {
    const count = countRequests()
    await findOnPage()
    await waitFor(() => expect(count(/\/drawing-sets\/[^/]+\/file\/$/)).toBe(1))
    const listsBefore = count(/^GET .*\/drawing-sets\/[^/]+\/pages\/$/)
    await userEvent.click(screen.getByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByText(/5 columns added on 1 page\./)).toBeInTheDocument()
    await waitFor(() => expect(count(/^GET .*\/drawing-sets\/[^/]+\/pages\/$/)).toBeGreaterThan(listsBefore))
    expect(count(/\/drawing-sets\/[^/]+\/file\/$/)).toBe(1)
  })

  it('follows the search already running on the set instead of failing', async () => {
    let polls = 0
    server.use(
      http.post('*/api/v1/drawing-pages/:id/find-similar-columns/jobs/', () =>
        HttpResponse.json(
          { error: { code: 'similar_search_running', message: 'A search of this drawing set is already running.', details: { job_id: 'theirs' }, request_id: 'r' } },
          { status: 409 },
        ),
      ),
      http.get('*/api/v1/similar-columns-jobs/theirs/', () => {
        polls += 1
        const done = polls >= 3
        return HttpResponse.json({
          ...JOB,
          id: 'theirs',
          status: done ? 'completed' : 'processing',
          progress: done ? 100 : 50,
          stage: 'Searching',
          pages_total: 4,
          pages_done: done ? 4 : 2,
          result: done ? { added: 7, pages: [{ page_id: 'p2', page_number: 2, added: 4 }, { page_id: 'p3', page_number: 3, added: 3 }], template: { width_pt: 6, height_pt: 3 } } : null,
        })
      }),
    )
    await findOnPage()
    await userEvent.click(screen.getByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByText(/Searching every plan of this set: 2 of 4 plans/)).toBeInTheDocument()
    expect(await screen.findByText(/7 columns added on 2 pages\./)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says why a search stopped part-way, with what it added before', async () => {
    const message = 'The set was too large to search in one go: the plans searched so far are kept. Search again to finish it.'
    server.use(
      http.get('*/api/v1/similar-columns-jobs/:id/', ({ params }) =>
        HttpResponse.json({
          ...JOB,
          id: params.id,
          status: 'failed',
          error_code: 'timed_out',
          error_message: message,
          pages_total: 12,
          pages_done: 5,
          result: { added: 2, pages: [{ page_id: 'p2', page_number: 2, added: 2 }], template: { width_pt: 6, height_pt: 3 } },
        }),
      ),
    )
    const count = countRequests()
    await findOnPage()
    const listsBefore = count(/^GET .*\/drawing-sets\/[^/]+\/pages\/$/)
    await userEvent.click(screen.getByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByText(`${message} 2 columns added on 1 page before it stopped.`)).toBeInTheDocument()
    // Columns were added before it stopped: the pages are refreshed.
    await waitFor(() => expect(count(/^GET .*\/drawing-sets\/[^/]+\/pages\/$/)).toBeGreaterThan(listsBefore))
  })

  it('shows the search again when the person leaves the page and comes back', async () => {
    const view = await openProcessedPage()
    await screen.findByRole('table', { name: /Detected members/ })
    await userEvent.click(screen.getByRole('button', { name: 'Find similar' }))
    await userEvent.click(screen.getByRole('img', { name: /Drawing/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByText(/Searching every plan of this set/)).toBeInTheDocument()

    await view.router.navigate(`/projects/${mockProjects.all[0]!.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Warehouse' })
    await view.router.navigate(`/projects/${mockProjects.all[0]!.id}/pages/${view.page.id}`)
    expect(await screen.findByText(/5 columns added on 1 page\./)).toBeInTheDocument()
  })

  it("shows the backend's message when there is nothing to match", async () => {
    server.use(
      http.post('*/api/v1/drawing-pages/:id/find-similar-columns/jobs/', () =>
        HttpResponse.json({ error: { code: 'no_symbol', message: 'Nothing is drawn there to match.', details: {}, request_id: 'r' } }, { status: 409 }),
      ),
    )
    await findOnPage()
    await userEvent.click(screen.getByRole('button', { name: 'Also on every plan of this set' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing is drawn there to match.')
    expect(screen.queryByText(/Searching every plan/)).not.toBeInTheDocument()
  })
})

const JOB = {
  page: 'p1',
  drawing_set: 's1',
  point: [500, 500],
  progress: 0,
  stage: '',
  result: null,
  error_code: '',
  error_message: '',
  requested_by: null,
  created_at: '2026-10-26T09:00:00Z',
  started_at: null,
  finished_at: null,
}

describe('Permissions', () => {
  it('viewers see members read-only', async () => {
    await openProcessedPage() // the owner processes the page
    await screen.findByRole('table', { name: /Detected members/ })
    cleanup()
    mockBackend.startSession('viewer@steelo.test')
    renderApp(`/projects/${mockProjects.all[0]!.id}/pages/${mockDrawings.sets[0]!.pages[0]!.id}`)
    const panel = await select(1)
    expect(within(panel).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(within(panel).queryByRole('button', { name: 'Accept' })).not.toBeInTheDocument()
    expect(within(panel).getByLabelText('Section')).toBeDisabled()
    expect(screen.queryByRole('button', { name: '+ Add member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Find similar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept all remaining/ })).not.toBeInTheDocument()
  })
})

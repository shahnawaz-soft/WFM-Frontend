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
  return { page, ...view }
}

const memberButton = (n: number, name = 'W12X26') => screen.getByRole('button', { name: `${name}, member ${n}. Show on drawing` })
const editor = () => screen.getByRole('region', { name: /member \d+$/ })

async function select(n: number, name?: string) {
  await screen.findByRole('table', { name: /Detected members/ })
  await userEvent.click(memberButton(n, name))
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
    expect(screen.getByText(/Click on a column symbol Steelo missed/)).toBeInTheDocument()
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

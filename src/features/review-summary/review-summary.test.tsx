import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it, onTestFinished } from 'vitest'

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

type Member = { id: string; profile: string; version: number; length_mm: unknown }

async function setup({ process = false, add = false } = {}) {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:2'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  if (process || add) await call('POST', `/drawing-pages/${page.id}/run-plan/`)
  if (add) {
    await call('POST', `/drawing-pages/${page.id}/accept-all/`)
    const members: Member[] = await call('GET', `/drawing-pages/${page.id}/members/`)
    const hss = members.find((m) => m.profile === 'HSS')!
    await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'unsupported' })
    await call('POST', `/drawing-pages/${page.id}/mark-reviewed/`)
    await call('POST', `/drawing-pages/${page.id}/add-to-project/`)
  }
  return { project, page }
}

async function openCard(projectId: string) {
  renderApp(`/projects/${projectId}`)
  const card = await screen.findByRole('region', { name: 'Project review' })
  await within(card).findByText(/Not started|In progress|ABM complete/)
  return card
}

describe('Project review summary', () => {
  it('asks for the summary once when the project page opens', async () => {
    const { project } = await setup()
    let requests = 0
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith(`/projects/${project.id}/summary/`)) requests++
    })
    onTestFinished(() => server.events.removeAllListeners())
    // The drawing sets answer after the summary (a larger response), as they often do.
    server.use(
      http.get(`*/api/v1/projects/${project.id}/drawing-sets/`, async () => {
        await waitFor(() => expect(requests).toBe(1))
        await new Promise((resolve) => setTimeout(resolve, 50)) // then falls through to the default handler
      }),
    )
    await openCard(project.id)
    await screen.findByRole('list', { name: 'Pages of GA.pdf' }) // the drawing sets have loaded too
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(requests).toBe(1)
  })

  it('refreshes the summary when the drawing sets change', async () => {
    const { project } = await setup()
    let requests = 0
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith(`/projects/${project.id}/summary/`)) requests++
    })
    onTestFinished(() => server.events.removeAllListeners())
    const { queryClient } = renderApp(`/projects/${project.id}`)
    await screen.findByRole('list', { name: 'Pages of GA.pdf' })
    await waitFor(() => expect(requests).toBeGreaterThan(0))
    const before = requests
    // Another set uploaded: the upload panel refreshes the project's drawing sets, as here.
    await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'More.pdf'))
    await queryClient.invalidateQueries({ queryKey: ['project', project.id, 'drawing-sets'] })
    await screen.findByRole('article', { name: 'More.pdf' })
    await waitFor(() => expect(requests).toBe(before + 1))
  })

  it('shows a new project as not started', async () => {
    const { project } = await setup()
    const card = await openCard(project.id)
    expect(within(card).getByText('Not started')).toBeInTheDocument()
    expect(within(card).getByText('none yet')).toBeInTheDocument() // open items
    const next = within(card).getByRole('group', { name: 'Next step' })
    expect(within(next).getByText('Run Plan on the framing plans')).toBeInTheDocument()
    expect(within(card).getByRole('listitem', { current: 'step' })).toHaveTextContent('Run Plan')
    expect(within(card).getByText(/Not generated/)).toBeInTheDocument() // wireframe
    expect(within(card).getByText('Not finalised')).toBeInTheDocument()
  })

  it('counts pages by status and lists the pages to look at', async () => {
    const { project, page } = await setup({ process: true })
    const card = await openCard(project.id)
    expect(within(card).getByText('In progress')).toBeInTheDocument()
    const counts = within(card).getByLabelText('Pages by status')
    expect(within(counts).getByText('Pending').nextSibling).toHaveTextContent('1')
    expect(within(counts).getByText('Processed').nextSibling).toHaveTextContent('1')
    const pages = within(card).getByRole('list', { name: 'Pages to look at' })
    expect(within(pages).getByRole('link', { name: 'Page 1 · GA.pdf' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/pages/${page.id}`,
    )
    expect(within(pages).getByText('Not reviewed')).toBeInTheDocument()
  })

  it('lists unresolved exceptions with a way to each', async () => {
    const { project } = await setup({ add: true })
    const card = await openCard(project.id)
    const list = within(card).getByRole('list', { name: 'Unresolved exceptions' })
    const noLength = within(list).getByText(/1 entries have no length/).closest('li')!
    expect(within(noLength).getByRole('link', { name: 'Show' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/abm?length_missing=true&match=matched`,
    )
    expect(within(list).getByText(/unsupported section type/)).toBeInTheDocument()
    expect(within(card).getByText(/0\.43 US tons/)).toBeInTheDocument()
    expect(within(card).getByText(/· not complete/)).toBeInTheDocument()
  })

  it('says when the ABM is complete', async () => {
    const { project, page } = await setup({ add: true })
    const members: Member[] = await call('GET', `/drawing-pages/${page.id}/members/`)
    const unmeasured = members.find((m) => m.profile === 'W' && m.length_mm == null)!
    await call('PATCH', `/members/${unmeasured.id}/`, { version: unmeasured.version, length: "10'" })
    const hss = members.find((m) => m.profile === 'HSS')!
    await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'rejected', reason: 'Not ours' })

    const card = await openCard(project.id)
    expect(within(card).getByText('ABM complete')).toBeInTheDocument()
    expect(within(card).getByText('none in the ABM')).toBeInTheDocument()
    const next = within(card).getByRole('group', { name: 'Next step' })
    expect(within(next).getByText('Ready to finalise')).toBeInTheDocument()
    expect(within(next).getByRole('button', { name: 'Finalise…' })).toBeInTheDocument()
    expect(within(card).getByText(/· complete/)).toBeInTheDocument()
  })
})

describe('Project history', () => {
  it('shows changes, runs and errors with who and when, and filters them', async () => {
    const { project } = await setup({ add: true })
    const card = await openCard(project.id)
    await userEvent.click(within(card).getByRole('link', { name: 'Project history' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Project history' })).toBeInTheDocument()
    expect(await screen.findByText('Created the project “Warehouse”')).toBeInTheDocument()
    expect(screen.getByText('Uploaded GA.pdf (2 pages)')).toBeInTheDocument()
    const failed = screen.getByText(/Run Plan failed on page 9/).closest('li')!
    expect(within(failed).getByText('Error')).toBeInTheDocument()
    expect(within(failed).getByText(/^Background job/)).toBeInTheDocument()
    const reviewed = screen.getAllByText(/^Reviewed HSS6X6X1\/4/)[0]!.closest('li')!
    expect(within(reviewed).getByRole('link', { name: 'Show member' })).toHaveAttribute('href', expect.stringContaining('?member='))

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'processing')
    await waitFor(() => expect(screen.queryByText('Created the project “Warehouse”')).not.toBeInTheDocument())
    expect(screen.getByText(/Run Plan finished on page 1/)).toBeInTheDocument()
  })
})

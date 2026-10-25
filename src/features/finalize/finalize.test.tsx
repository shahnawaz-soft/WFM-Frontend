import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { preloadRoutes, renderApp } from '../../test/renderApp'

vi.mock('../viewer/pdf', () => ({ loadPdf: async () => ({ numPages: 1 }) }))
vi.mock('../viewer/PdfPageCanvas', () => ({ PdfPageCanvas: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }))

beforeAll(() => preloadRoutes('/projects/p/abm'))

const OWNER = 'estimator@steelo.test'

async function call(method: string, path: string, body?: object) {
  const response = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  return response.status === 204 ? null : response.json()
}

type Member = { id: string; profile: string; version: number; length_mm: unknown }

/** Page 1 reviewed and added: W12X26 without a length + HSS unsupported = 2 exceptions.
 *  ``complete`` resolves them (length entered, HSS rejected). */
async function project({ add = true, complete = false } = {}) {
  mockBackend.addUser('editor@steelo.test', 'member', 'Ed', 'Editor')
  const p = mockProjects.create('Warehouse', OWNER, { 'editor@steelo.test': 'editor' })
  mockBackend.startSession(OWNER)
  await acceptUpload(p.id, new File(['%PDF-1.7 pages:1'], 'GA.pdf'))
  const page = mockDrawings.sets[0]!.pages[0]!
  await call('POST', `/drawing-pages/${page.id}/run-plan/`)
  if (add) {
    await call('POST', `/drawing-pages/${page.id}/accept-all/`)
    const members: Member[] = await call('GET', `/drawing-pages/${page.id}/members/`)
    const hss = members.find((m) => m.profile === 'HSS')!
    await call('POST', `/members/${hss.id}/review/`, { version: hss.version, status: 'unsupported' })
    await call('POST', `/drawing-pages/${page.id}/mark-reviewed/`)
    await call('POST', `/drawing-pages/${page.id}/add-to-project/`)
    if (complete) {
      const w = members.find((m) => m.profile === 'W' && m.length_mm == null)!
      await call('PATCH', `/members/${w.id}/`, { version: w.version, length: "10'" })
      const fresh: Member[] = await call('GET', `/drawing-pages/${page.id}/members/`)
      const h = fresh.find((m) => m.profile === 'HSS')!
      await call('POST', `/members/${h.id}/review/`, { version: h.version, status: 'rejected', reason: 'Not ours' })
    }
  }
  return p
}

async function openFinalize(projectId: string) {
  renderApp(`/projects/${projectId}`)
  const card = await screen.findByRole('region', { name: 'Project review' })
  await userEvent.click(await within(card).findByRole('button', { name: 'Finalise…' }))
  return screen.findByRole('dialog', { name: /Finalise version 1/ })
}

describe('Finalising a project', () => {
  it('needs the unresolved exceptions accepted, then freezes version 1', async () => {
    const p = await project()
    const dialog = await openFinalize(p.id)
    const exceptions = within(dialog).getByRole('group', { name: 'Unresolved exceptions' })
    expect(within(exceptions).getByText(/1 entries have no length/)).toBeInTheDocument()
    const submit = within(dialog).getByRole('button', { name: 'Finalise version 1' })
    expect(submit).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /I accept these unresolved items in version 1/ }))
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Bid issue')
    await userEvent.click(submit)

    expect(await screen.findByText('Finalised as version 1')).toBeInTheDocument()
    expect(await screen.findByText(/This project is finalised/)).toBeInTheDocument()
    const versions = await screen.findByRole('list', { name: 'Finalised versions' })
    const v1 = within(versions).getByText('Version 1').closest('li')!
    expect(within(v1).getByText('Current')).toBeInTheDocument()
    expect(within(v1).getByText('2 exceptions accepted')).toBeInTheDocument()
    expect(within(v1).getByText('“Bid issue”')).toBeInTheDocument()
    const card = screen.getByRole('region', { name: 'Project review' })
    expect(within(card).queryByRole('button', { name: 'Finalise…' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'Reopen…' })).toBeInTheDocument()
  })

  it('finalises a complete project without an acknowledgement', async () => {
    const p = await project({ complete: true })
    const dialog = await openFinalize(p.id)
    expect(within(dialog).getByText('✓ No unresolved exceptions.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalise version 1' }))
    expect(await screen.findByText('Finalised as version 1')).toBeInTheDocument()
  })

  it('does not offer finalising with nothing in the ABM; the next step says what to do', async () => {
    const p = await project({ add: false })
    renderApp(`/projects/${p.id}`)
    const card = await screen.findByRole('region', { name: 'Project review' })
    const next = await within(card).findByRole('group', { name: 'Next step' })
    expect(within(next).getByText('Review 1 processed page')).toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: 'Finalise…' })).not.toBeInTheDocument()
  })

  it('reopens with a reason; the version stays and is marked superseded', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    renderApp(`/projects/${p.id}`)
    const card = await screen.findByRole('region', { name: 'Project review' })
    await userEvent.click(await within(card).findByRole('button', { name: 'Reopen…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Reopen the project?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen project' }))
    expect(within(dialog).getByText('Say why the project is reopened.')).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Addendum 3')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reopen project' }))
    expect(await screen.findByText('Project reopened')).toBeInTheDocument()
    const versions = await screen.findByRole('list', { name: 'Finalised versions' })
    await waitFor(() => expect(within(versions).getByText('Superseded')).toBeInTheDocument())
    expect(within(versions).getByText(/Addendum 3/)).toBeInTheDocument()
    expect(await within(card).findByRole('button', { name: 'Finalise…' })).toBeInTheDocument()
  })

  it('editors cannot finalise', async () => {
    const p = await project({ complete: true })
    mockBackend.startSession('editor@steelo.test')
    renderApp(`/projects/${p.id}`)
    const card = await screen.findByRole('region', { name: 'Project review' })
    await within(card).findByText(/In progress|ABM complete/)
    expect(within(card).queryByRole('button', { name: 'Finalise…' })).not.toBeInTheDocument()
  })
})

describe('A finalised project', () => {
  const created: string[] = []
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => {
      created.push('blob')
      return 'blob:mock'
    })
    URL.revokeObjectURL = vi.fn()
  })
  afterEach(() => {
    created.length = 0
  })

  it('downloads its versions', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp(`/projects/${p.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Download version 1 as Excel' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    const link = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(link.download).toBe('Warehouse-v1-ABM.xlsx')
    click.mockRestore()
  })

  it('offers the wireframe as IFC for Tekla only when the version has one', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    renderApp(`/projects/${p.id}`)
    await screen.findByRole('button', { name: 'Download version 1 as Excel' })
    expect(screen.queryByRole('button', { name: /as IFC for Tekla/ })).not.toBeInTheDocument()
  })

  it('downloads the wireframe as IFC', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/wireframes/`)
    await call('POST', `/projects/${p.id}/finalize/`, {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp(`/projects/${p.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Download version 1 wireframe as IFC for Tekla' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('Warehouse-v1-wireframe.ifc')
    click.mockRestore()
  })

  it('is read-only in the ABM', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    renderApp(`/projects/${p.id}/abm`)
    expect(await screen.findByText(/Finalised and read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Add entry' })).not.toBeInTheDocument()
  })

  it('exports the finalised version from the ABM', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderApp(`/projects/${p.id}/abm`)
    const group = await screen.findByRole('group', { name: 'Export version 1' })
    await userEvent.click(within(group).getByRole('button', { name: 'Download version 1 as Excel' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect((click.mock.instances[0] as unknown as HTMLAnchorElement).download).toBe('Warehouse-v1-ABM.xlsx')
    click.mockRestore()
  })

  it('explains from the ABM that exports need a finalised version, and finalises from there', async () => {
    const p = await project({ complete: true })
    renderApp(`/projects/${p.id}/abm`)
    await userEvent.click(await screen.findByRole('button', { name: 'Export…' }))
    const dialog = await screen.findByRole('dialog', { name: 'Export the ABM' })
    expect(within(dialog).getByText(/finalised version/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Finalise…' }))
    const finalize = await screen.findByRole('dialog', { name: /Finalise version 1/ })
    await userEvent.click(within(finalize).getByRole('button', { name: /Finalise version 1/ }))
    expect(await screen.findByRole('group', { name: 'Export version 1' })).toBeInTheDocument()
  })

  it('is listed with the current projects', async () => {
    const p = await project({ complete: true })
    await call('POST', `/projects/${p.id}/finalize/`, {})
    renderApp('/projects')
    const row = (await screen.findByRole('link', { name: 'Warehouse' })).closest('tr')!
    expect(within(row).getByText('Finalised')).toBeInTheDocument()
  })
})

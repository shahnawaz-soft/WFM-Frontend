import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { beforeEach, describe, expect, it, onTestFinished } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const OWNER = 'estimator@steelo.test' // Esha Estimator (member)

beforeEach(() => {
  mockBackend.addUser('detailer@steelo.test', 'member', 'Dev', 'Detailer', 'dev')
  mockBackend.addUser('viewer@steelo.test', 'member', 'Vik', 'Viewer')
  mockBackend.addUser('operator@steelo.test', 'operator', 'Omar', 'Operator')
})

const signedInAs = (email: string) => mockBackend.startSession(email)

describe('Projects list', () => {
  it('offers to create the first project when there are none', async () => {
    signedInAs(OWNER)
    renderApp('/projects')
    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create your first project' })).toBeInTheDocument()
  })

  it('lists projects in a table with a page-1 thumbnail, text status and tonnage', async () => {
    const p = mockProjects.create('Warehouse Extension', OWNER, { 'detailer@steelo.test': 'editor' })
    Object.assign(p, {
      cover_page: 'page-1',
      tonnage: { lb: '12340.0', kg: '5597.3', short_tons: '6.170', tonnes: '5.597' },
    })
    signedInAs('detailer@steelo.test')
    renderApp('/projects')
    const table = await screen.findByRole('table', { name: /Projects/ })
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Drawing',
      'Project',
      'Status',
      'Tonnage',
      'Last updated',
    ])
    const row = (await screen.findByRole('link', { name: 'Warehouse Extension' })).closest('tr')!
    expect(within(row).getByText('Active')).toBeInTheDocument()
    expect(within(row).getByText('6.17 US tons')).toBeInTheDocument()
    expect(within(row).getByText('5.60 t')).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: 'Page 1 of Warehouse Extension', hidden: true })).toBeInTheDocument() // the name beside it is the link
  })

  it('separates archived projects behind the status filter', async () => {
    mockProjects.create('Old Depot', OWNER, {}, 'archived')
    mockProjects.create('New Mall', OWNER)
    signedInAs(OWNER)
    renderApp('/projects')
    await screen.findByRole('link', { name: 'New Mall' })
    expect(screen.queryByRole('link', { name: 'Old Depot' })).not.toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'archived')
    expect(await screen.findByRole('link', { name: 'Old Depot' })).toBeInTheDocument()
  })

  it('creates a project and opens it as owner', async () => {
    signedInAs(OWNER)
    renderApp('/projects')
    await userEvent.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'New project' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByText('Enter a project name.')).toBeInTheDocument()

    await userEvent.type(within(dialog).getByLabelText('Project name'), 'Airport Hangar')
    await userEvent.type(within(dialog).getByLabelText('Client name'), 'Acme Builders')
    await userEvent.type(within(dialog).getByLabelText('Team'), 'Team North')
    await userEvent.type(within(dialog).getByLabelText('Tekla version'), '2024 SP3')
    await userEvent.type(within(dialog).getByLabelText('Target completion date'), '2026-12-15')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Airport Hangar' })).toBeInTheDocument()
    expect(screen.getByText(/Acme Builders · Team North · Tekla 2024 SP3 · Target 15 Dec 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Project settings' })).toBeInTheDocument() // owner actions
  })
})

describe('Project details', () => {
  it('shows a clear not-found page for projects the user cannot see', async () => {
    const p = mockProjects.create('Secret Job', 'admin@steelo.test')
    signedInAs(OWNER)
    renderApp(`/projects/${p.id}`)
    expect(await screen.findByRole('heading', { name: 'Project not found' })).toBeInTheDocument()
  })

  it('hides owner actions from a viewer', async () => {
    const p = mockProjects.create('Warehouse', OWNER, { 'viewer@steelo.test': 'viewer' })
    signedInAs('viewer@steelo.test')
    renderApp(`/projects/${p.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Warehouse' })
    await screen.findByRole('table')
    for (const name of ['Project settings', 'Archive', 'Add member']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument()
    }
    expect(within(screen.getByRole('table')).getByText('Owner')).toBeInTheDocument() // role as text, no select
  })

  it('renames the project and changes its settings', async () => {
    const p = mockProjects.create('Warehouse', OWNER)
    signedInAs(OWNER)
    renderApp(`/projects/${p.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    expect(within(dialog).getByText('No drawings uploaded yet')).toBeInTheDocument() // upload date, read-only
    const input = within(dialog).getByLabelText('Project name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Warehouse Rev B')
    await userEvent.type(within(dialog).getByLabelText('Team'), 'Team South')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Warehouse Rev B' })).toBeInTheDocument()
    expect(screen.getByText(/Team South/)).toBeInTheDocument()
  })

  it('explains a conflicting edit and lets the user retry on the latest version', async () => {
    const p = mockProjects.create('Warehouse', OWNER)
    signedInAs(OWNER)
    renderApp(`/projects/${p.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    p.version += 1 // someone else saved meanwhile
    p.name = 'Renamed elsewhere'
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('changed by someone else')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('archives after confirmation, becomes read-only, and restores', async () => {
    const p = mockProjects.create('Warehouse', OWNER)
    signedInAs(OWNER)
    renderApp(`/projects/${p.id}`)
    await userEvent.click(await screen.findByRole('button', { name: 'Archive' }))
    const dialog = await screen.findByRole('dialog', { name: /Archive “Warehouse”/ })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    expect(await screen.findByText(/This project is archived and read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Project settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add member' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Restore project' }))
    expect(await screen.findByRole('button', { name: 'Project settings' })).toBeInTheDocument()
  })
})

describe('Project page requests', () => {
  it('loads the drawing sets in parallel with the project, not after it', async () => {
    const project = mockProjects.create('Warehouse', OWNER)
    mockBackend.startSession(OWNER)
    let setsRequested = false
    let releaseProject = () => {}
    const projectHeld = new Promise<void>((resolve) => (releaseProject = resolve))
    server.events.on('request:start', ({ request }) => {
      if (new URL(request.url).pathname.endsWith(`/projects/${project.id}/drawing-sets/`)) setsRequested = true
    })
    onTestFinished(() => {
      releaseProject()
      server.events.removeAllListeners()
    })
    server.use(
      http.get(`*/api/v1/projects/${project.id}/`, async () => {
        await projectHeld // then falls through to the default handler
      }),
    )
    renderApp(`/projects/${project.id}`)
    await waitFor(() => expect(setsRequested).toBe(true)) // while the project is still loading
    expect(screen.getByText('Loading project…')).toBeInTheDocument()
    releaseProject()
    expect(await screen.findByRole('heading', { level: 1, name: 'Warehouse' })).toBeInTheDocument()
  })
})

describe('Project members', () => {
  async function openAsOwner() {
    const p = mockProjects.create('Warehouse', OWNER, { 'detailer@steelo.test': 'editor' })
    signedInAs(OWNER)
    renderApp(`/projects/${p.id}`)
    await screen.findByRole('heading', { level: 1, name: 'Warehouse' })
    await screen.findByRole('table') // members load separately
    return p
  }

  it('adds a member found by search, excluding existing members', async () => {
    await openAsOwner()
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    await userEvent.type(within(dialog).getByLabelText('Find a person'), 'vi')
    const results = await within(dialog).findByRole('list', { name: 'Matching people' })
    await userEvent.click(within(results).getByRole('button', { name: /Vik Viewer/ }))
    await userEvent.selectOptions(within(dialog).getByLabelText('Project role'), 'viewer')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add member' }))

    expect(await screen.findByText('Member added')).toBeInTheDocument()
    expect(await screen.findByText('viewer@steelo.test')).toBeInTheDocument()
  })

  it('does not offer people who are already members', async () => {
    await openAsOwner()
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    await userEvent.type(within(dialog).getByLabelText('Find a person'), 'dev')
    expect(await within(dialog).findByText('No one found who isn’t already a member.')).toBeInTheDocument()
  })

  it('requires choosing a person', async () => {
    await openAsOwner()
    await userEvent.click(screen.getByRole('button', { name: 'Add member' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add member' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add member' }))
    expect(within(dialog).getByText('Choose a person to add.')).toBeInTheDocument()
  })

  it('changes a member role inline', async () => {
    await openAsOwner()
    await userEvent.selectOptions(screen.getByLabelText('Project role for detailer@steelo.test'), 'reviewer')
    expect(await screen.findByText('Role updated')).toBeInTheDocument()
    expect(screen.getByLabelText('Project role for detailer@steelo.test')).toHaveValue('reviewer')
  })

  it('refuses to demote the last owner and keeps the select accurate', async () => {
    await openAsOwner()
    await userEvent.selectOptions(screen.getByLabelText(`Project role for ${OWNER}`), 'viewer')
    expect(await screen.findByText(/must keep at least one owner/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText(`Project role for ${OWNER}`)).toHaveValue('owner'))
  })

  it('removes a member after confirmation', async () => {
    await openAsOwner()
    await userEvent.click(screen.getByRole('button', { name: 'Remove detailer@steelo.test' }))
    const dialog = await screen.findByRole('dialog', { name: 'Remove Dev Detailer?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove member' }))
    await waitFor(() => expect(screen.queryByText('detailer@steelo.test')).not.toBeInTheDocument())
  })

  it('shows why the last owner cannot leave', async () => {
    await openAsOwner()
    await userEvent.click(screen.getByRole('button', { name: `Remove ${OWNER}` }))
    const dialog = await screen.findByRole('dialog', { name: 'Leave this project?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Leave project' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('must keep at least one owner')
  })
})

describe('Start page', () => {
  it('opens on Projects; there is no Home page for now', async () => {
    mockProjects.create('Warehouse', OWNER)
    signedInAs(OWNER)
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: 'Warehouse' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: /main/i })
    expect(within(nav).queryByRole('link', { name: 'Home' })).not.toBeInTheDocument()
  })
})

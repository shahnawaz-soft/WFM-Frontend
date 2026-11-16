import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { mockDrawings } from '../../test/mockDrawings'
import { acceptUpload } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

const OWNER = 'estimator@steelo.test'

async function openProject(members: Record<string, 'editor' | 'reviewer'> = {}) {
  const project = mockProjects.create('Warehouse', OWNER, members)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
  renderApp(`/projects/${project.id}`)
  await screen.findByRole('list', { name: 'Pages of GA.pdf' })
  return project
}

async function addToNewBatch(name: string, ...pages: number[]) {
  await tick(...pages)
  await userEvent.click(screen.getByRole('button', { name: `Add to batch… (${pages.length})` }))
  const dialog = await screen.findByRole('dialog', { name: `Add ${pages.length} ${pages.length === 1 ? 'page' : 'pages'} to a batch` })
  const existing = within(dialog).queryByLabelText('Batch')
  if (existing) await userEvent.selectOptions(existing, 'New batch…')
  await userEvent.type(within(dialog).getByLabelText('New batch name'), name)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))
  await within(await screen.findByRole('list', { name: 'Batches' })).findByRole('link', { name })
}

const cards = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))

async function tick(...pages: number[]) {
  await userEvent.click(screen.getByRole('button', { name: 'Select pages' }))
  for (const n of pages) await userEvent.click(screen.getByRole('checkbox', { name: `Select page ${n} of GA.pdf` }))
}

describe('Batches of pages', () => {
  it('lists each batch on the project page and opens it on its own page, in the order ticked', async () => {
    await openProject()
    await addToNewBatch('Level 2 framing', 3, 1)
    const row = screen.getByRole('listitem', { name: 'Level 2 framing' })
    expect(row).toHaveTextContent('Not assigned')
    expect(row).toHaveTextContent('2 pages')
    // every page stays on the project page, those in the batch marked with it
    const all = screen.getByRole('list', { name: 'Pages of GA.pdf' })
    expect(cards(all)).toEqual(['Page 1', 'Page 2', 'Page 3'])
    expect(within(all).getAllByRole('link', { name: 'Level 2 framing' })).toHaveLength(2)

    await userEvent.click(within(screen.getByRole('list', { name: 'Batches' })).getByRole('link', { name: 'Level 2 framing' }))
    const batch = await screen.findByRole('list', { name: 'Pages in Level 2 framing' })
    expect(screen.getByRole('heading', { level: 1, name: 'Level 2 framing' })).toBeInTheDocument()
    await waitFor(() => expect(cards(batch)).toEqual(['Page 3', 'Page 1']))
    await userEvent.click(within(batch).getByRole('button', { name: 'Move page 1 earlier' }))
    await waitFor(() => expect(cards(screen.getByRole('list', { name: 'Pages in Level 2 framing' }))).toEqual(['Page 1', 'Page 3']))
  })

  it('adds pages to an existing batch, and deleting a batch keeps its pages', async () => {
    await openProject()
    await addToNewBatch('Roof', 1)
    await tick(2)
    await userEvent.click(screen.getByRole('button', { name: 'Add to batch… (1)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add 1 page to a batch' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Batch'), 'Roof')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))
    await waitFor(() => expect(screen.getByRole('listitem', { name: 'Roof' })).toHaveTextContent('2 pages'))

    await userEvent.click(within(screen.getByRole('list', { name: 'Batches' })).getByRole('link', { name: 'Roof' }))
    await waitFor(async () => expect(cards(await screen.findByRole('list', { name: 'Pages in Roof' }))).toEqual(['Page 1', 'Page 2']))
    await userEvent.click(screen.getByRole('button', { name: 'Delete batch Roof' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete the batch “Roof”?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete batch' }))
    // back on the project page, the pages out of any batch
    await waitFor(() => expect(cards(screen.getByRole('list', { name: 'Pages of GA.pdf' }))).toEqual(['Page 1', 'Page 2', 'Page 3']))
  })

  it('an owner assigns one or several engineers to a batch', async () => {
    mockBackend.addUser('ali@steelo.test', 'member', 'Ali', 'Khan')
    mockBackend.addUser('sara@steelo.test', 'member', 'Sara', 'Lee')
    await openProject({ 'ali@steelo.test': 'editor', 'sara@steelo.test': 'editor' })
    await addToNewBatch('Level 1', 1)
    await userEvent.click(screen.getByRole('button', { name: 'Assign batch Level 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign “Level 1”' })
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Ali Khan/ }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Sara Lee/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('listitem', { name: 'Level 1' })).toHaveTextContent('Assigned to Ali Khan, Sara Lee'))
  })

  it('an owner finds someone not in the project, who joins it as an editor when assigned', async () => {
    mockBackend.addUser('nadia@steelo.test', 'member', 'Nadia', 'Rahman')
    const project = await openProject()
    await addToNewBatch('Level 3', 1)
    await userEvent.click(screen.getByRole('button', { name: 'Assign batch Level 3' }))
    const dialog = await screen.findByRole('dialog', { name: 'Assign “Level 3”' })
    await userEvent.type(within(dialog).getByLabelText('Add someone not in this project'), 'nad')
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add Nadia Rahman' }))
    expect(within(dialog).getByRole('checkbox', { name: /Nadia Rahman/ })).toBeChecked()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.getByRole('listitem', { name: 'Level 3' })).toHaveTextContent('Assigned to Nadia Rahman'))
    const joined = mockProjects.all.find((p) => p.id === project.id)!.members.find((m) => m.user.email === 'nadia@steelo.test')
    expect(joined?.role).toBe('editor')
  })

  it('an editor sees their batches first, and only looks at pages of batches assigned to others', async () => {
    mockBackend.addUser('ali@steelo.test', 'member', 'Ali', 'Khan')
    mockBackend.addUser('sara@steelo.test', 'member', 'Sara', 'Lee')
    const project = await openProject({ 'ali@steelo.test': 'editor', 'sara@steelo.test': 'editor' })
    await addToNewBatch('Level 1', 1)
    await addToNewBatch('Level 2', 2)
    const ids = (name: string) => mockDrawings.batchId(project.id, name)
    mockDrawings.assign(ids('Level 1'), ['sara@steelo.test'])
    mockDrawings.assign(ids('Level 2'), ['ali@steelo.test'])

    cleanup()
    mockBackend.startSession('ali@steelo.test')
    renderApp(`/projects/${project.id}`)
    const list = await screen.findByRole('list', { name: 'Batches' })
    expect(cards(list)).toEqual(['Level 2', 'Level 1'])
    expect(within(list).getByRole('listitem', { name: 'Level 2' })).toHaveTextContent('Assigned to you')
    // project-wide changes are a lead's once batches are assigned
    expect(screen.queryByRole('button', { name: 'Upload PDF' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign batch/ })).not.toBeInTheDocument()

    await userEvent.click(within(list).getByRole('link', { name: 'Level 1' }))
    const theirs = await screen.findByRole('list', { name: 'Pages in Level 1' })
    expect(screen.getByText(/the engineers assigned work on them/)).toBeInTheDocument()
    expect(within(theirs).queryByRole('button', { name: /Rename sheet/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete batch Level 1' })).not.toBeInTheDocument()
  })
})

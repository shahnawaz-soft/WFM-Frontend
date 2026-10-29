import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

const OWNER = 'estimator@steelo.test'

async function openProject() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
  renderApp(`/projects/${project.id}`)
  await screen.findByRole('list', { name: 'Pages of GA.pdf' })
}

const cards = (list: HTMLElement) => within(list).getAllByRole('listitem').map((li) => li.getAttribute('aria-label'))

async function tick(...pages: number[]) {
  await userEvent.click(screen.getByRole('button', { name: 'Select pages' }))
  for (const n of pages) await userEvent.click(screen.getByRole('checkbox', { name: `Select page ${n} of GA.pdf` }))
}

describe('Batches of pages', () => {
  it('groups selected pages into a new batch, in the order ticked, and rearranges them', async () => {
    await openProject()
    await tick(3, 1)
    await userEvent.click(screen.getByRole('button', { name: 'Add to batch… (2)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add 2 pages to a batch' })
    await userEvent.type(within(dialog).getByLabelText('New batch name'), 'Level 2 framing')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))

    const batch = await screen.findByRole('list', { name: 'Pages in Level 2 framing' })
    await waitFor(() => expect(cards(batch)).toEqual(['Page 3', 'Page 1']))
    expect(cards(screen.getByRole('list', { name: 'Pages of GA.pdf' }))).toEqual(['Page 2']) // not in a batch

    await userEvent.click(within(batch).getByRole('button', { name: 'Move page 1 earlier' }))
    await waitFor(() => expect(cards(screen.getByRole('list', { name: 'Pages in Level 2 framing' }))).toEqual(['Page 1', 'Page 3']))
  })

  it('adds pages to an existing batch, and deleting a batch keeps its pages', async () => {
    await openProject()
    await tick(1)
    await userEvent.click(screen.getByRole('button', { name: 'Add to batch… (1)' }))
    let dialog = await screen.findByRole('dialog', { name: 'Add 1 page to a batch' })
    await userEvent.type(within(dialog).getByLabelText('New batch name'), 'Roof')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))
    await screen.findByRole('list', { name: 'Pages in Roof' })

    await tick(2)
    await userEvent.click(screen.getByRole('button', { name: 'Add to batch… (1)' }))
    dialog = await screen.findByRole('dialog', { name: 'Add 1 page to a batch' })
    await userEvent.selectOptions(within(dialog).getByLabelText('Batch'), 'Roof')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add pages' }))
    await waitFor(() => expect(cards(screen.getByRole('list', { name: 'Pages in Roof' }))).toEqual(['Page 1', 'Page 2']))

    await userEvent.click(screen.getByRole('button', { name: 'Delete batch Roof' }))
    const confirm = await screen.findByRole('dialog', { name: 'Delete the batch “Roof”?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete batch' }))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Pages in Roof' })).not.toBeInTheDocument())
    expect(cards(screen.getByRole('list', { name: 'Pages of GA.pdf' }))).toEqual(['Page 1', 'Page 2', 'Page 3'])
  })
})

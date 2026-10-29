import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

const OWNER = 'estimator@steelo.test'

async function projectWithPages() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
  return project
}

const pageCards = () =>
  within(screen.getByRole('list', { name: 'Pages of GA.pdf' }))
    .getAllByRole('listitem')
    .map((li) => li.getAttribute('aria-label'))

describe('Hiding selected pages', () => {
  it('hides only the ticked pages, and can show them again', async () => {
    const project = await projectWithPages()
    renderApp(`/projects/${project.id}`)
    await screen.findByRole('list', { name: 'Pages of GA.pdf' })

    await userEvent.click(screen.getByRole('button', { name: 'Select pages' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select page 1 of GA.pdf' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select page 3 of GA.pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Hide selected (2)' }))

    expect(await screen.findByText('2 pages hidden')).toBeInTheDocument()
    await waitFor(() => expect(pageCards()).toEqual(['Page 2']))

    await userEvent.click(await screen.findByRole('button', { name: 'Show hidden pages (2)' }))
    await waitFor(() => expect(pageCards()).toEqual(['Page 1', 'Page 2', 'Page 3']))
    const page1 = screen.getByRole('listitem', { name: 'Page 1' })
    expect(within(page1).getByText('Hidden')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Select pages' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select page 1 of GA.pdf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Show selected (1)' }))
    expect(await screen.findByText('1 page shown again')).toBeInTheDocument()
    expect(mockDrawings.sets[0]!.pages.map((p) => p.hidden)).toEqual([false, false, true])
  })

})

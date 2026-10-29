import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

const downloadDraftAbm = vi.fn(async () => {})
vi.mock('../../api/abm', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/abm')>()),
  downloadDraftAbm: (...args: unknown[]) => downloadDraftAbm(...(args as [])),
}))

const OWNER = 'estimator@steelo.test'

async function openProject() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:2'], 'GA.pdf'))
  renderApp(`/projects/${project.id}`)
  await screen.findByRole('heading', { level: 1, name: 'Warehouse' })
  return project
}

describe('Project page layout', () => {
  it('puts the ABM first, then the pages, and keeps the rest folded away', async () => {
    await openProject()
    const abm = await screen.findByRole('region', { name: 'ABM' })
    const pages = await screen.findByRole('region', { name: /^Pages/ })
    expect(abm.compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    for (const name of ['Review and finalise', 'Section data', 'Members']) {
      const group = screen.getByText(name, { selector: 'summary' }).closest('details')!
      expect(group).not.toHaveAttribute('open')
      expect(pages.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.queryByText(/Your role:/)).not.toBeInTheDocument()
  })

  it('downloads the ABM from the project page', async () => {
    const project = await openProject()
    const abm = await screen.findByRole('region', { name: 'ABM' })
    await userEvent.click(within(abm).getByRole('button', { name: 'Download ABM' }))
    await waitFor(() => expect(downloadDraftAbm).toHaveBeenCalledWith(project.id, 'Warehouse-ABM.xlsx'))
  })
})

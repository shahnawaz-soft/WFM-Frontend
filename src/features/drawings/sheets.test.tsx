import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { acceptUpload, mockDrawings } from '../../test/mockDrawings'
import { mockProjects } from '../../test/mockProjects'
import { renderApp } from '../../test/renderApp'

const OWNER = 'estimator@steelo.test'

async function call(path: string, body?: object) {
  await fetch(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

/** Three run pages: two plans (one sharing its "number" with the other) and a detail sheet. */
async function openProject() {
  const project = mockProjects.create('Warehouse', OWNER)
  mockBackend.startSession(OWNER)
  await acceptUpload(project.id, new File(['%PDF-1.7 pages:3'], 'GA.pdf'))
  mockDrawings.sheetRead(1, { kind: 'plan', number: 'S302', title: 'THIRD FLOOR FRAMING PLAN' })
  mockDrawings.sheetRead(2, { kind: 'plan', number: 'AZP3', title: 'ROOF FRAMING PLAN' })
  mockDrawings.sheetRead(3, { kind: 'detail', number: 'AZP3', title: 'DETAILS' })
  for (const page of mockDrawings.sets[0]!.pages) await call(`/drawing-pages/${page.id}/run-plan/`)
  renderApp(`/projects/${project.id}`)
  return screen.findByRole('list', { name: 'Pages of GA.pdf' })
}

const card = (n: number) => screen.getByRole('listitem', { name: `Page ${n}` })

describe('Sheet names and kinds', () => {
  it('names each card by its sheet and says what kind of sheet it is', async () => {
    await openProject()
    expect(await within(card(1)).findByText('S302 · THIRD FLOOR FRAMING PLAN')).toBeInTheDocument()
    expect(within(card(1)).getByText('Plan')).toBeInTheDocument()
    // A "number" printed on every sheet of a file (a job code) is not the sheet's number.
    expect(within(card(2)).getByText('ROOF FRAMING PLAN')).toBeInTheDocument()
    expect(within(card(3)).getByText('Detail')).toBeInTheDocument()
  })

  it('shows only plans, or only another kind of sheet', async () => {
    await openProject()
    await within(card(1)).findByText('S302 · THIRD FLOOR FRAMING PLAN')
    await userEvent.click(screen.getByRole('button', { name: 'Plans (2)' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Page 3' })).not.toBeInTheDocument())
    expect(card(1)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Details (1)' }))
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Page 1' })).not.toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: 'All (3)' }))
    expect(await screen.findByRole('listitem', { name: 'Page 1' })).toBeInTheDocument()
  })

  it('lets a person correct a sheet name', async () => {
    await openProject()
    await within(card(1)).findByText('S302 · THIRD FLOOR FRAMING PLAN')
    await userEvent.click(within(card(1)).getByRole('button', { name: 'Rename sheet, page 1' }))
    const dialog = await screen.findByRole('dialog', { name: 'Sheet name' })
    const input = within(dialog).getByLabelText('Sheet name')
    await userEvent.clear(input)
    await userEvent.type(input, 'S-302 Level 3 framing')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    expect(await within(card(1)).findByText('S-302 Level 3 framing')).toBeInTheDocument()
  })
})

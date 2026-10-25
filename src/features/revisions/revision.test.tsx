import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { mockProjects } from '../../test/mockProjects'
import { preloadRoutes, renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

beforeAll(() => preloadRoutes('/projects/p/revisions/r'))

const OWNER = 'estimator@steelo.test'

const member = (id: string, designation: string, length: string) => ({
  id,
  page: id.startsWith('o') ? 'orig-12' : 'rev-12',
  designation,
  member_type: '',
  length_mm: '7315.2',
  length_display: length,
  quantity: 1,
  studs_text: '',
  camber_display: '',
  label_bbox: [0, 0, 1, 1],
})

const sheet = (id: string) => ({ page_id: id, page_number: 12, sheet_number: 'S201', title: '2ND FLOOR FRAMING PLAN', status: 'processed' })

const REPORT = {
  revision: { id: 'rev', original_filename: 'Structures rev 2.pdf' },
  original: { id: 'orig', original_filename: 'Structures.pdf' },
  summary: {
    added: 1,
    removed: 1,
    changed: 1,
    unchanged: 40,
    sheets_compared: 1,
    sheets_not_run: 1,
    sheets_new: 0,
    sheets_removed: 0,
    weight_delta_lb: '312.4',
    unweighed_changes: 0,
  },
  sheets: [
    {
      original: sheet('orig-12'),
      revised: sheet('rev-12'),
      method: 'sheet_number',
      status: 'compared',
      notes: [],
      counts: { added: 1, removed: 1, changed: 1, unchanged: 40 },
      weight_delta_lb: '312.4',
      changes: [
        { kind: 'changed', what: ['size'], original: member('o1', 'W12X26', `24'-0"`), revised: member('r1', 'W12X30', `24'-0"`), weight_delta_lb: '96.0' },
        { kind: 'removed', what: [], original: member('o2', 'W16X31', `20'-0"`), revised: null, weight_delta_lb: '-620.0' },
        { kind: 'added', what: [], original: null, revised: member('r3', 'W21X44', `19'-0"`), weight_delta_lb: '836.4' },
      ],
    },
  ],
}

describe('Revision', () => {
  it('lists every add, deduct and change with its weight, and re-pairs a sheet', async () => {
    const project = mockProjects.create('Structures', OWNER)
    mockBackend.startSession(OWNER)
    let paired: unknown = null
    server.use(
      http.get('*/api/v1/drawing-sets/rev/revision/', () => HttpResponse.json(REPORT)),
      http.post('*/api/v1/drawing-sets/rev/revision/pairs/', async ({ request }) => {
        paired = await request.json()
        return new HttpResponse(null, { status: 204 })
      }),
    )
    renderApp(`/projects/${project.id}/revisions/rev`)

    expect(await screen.findByRole('heading', { name: 'Revision: Structures rev 2.pdf' })).toBeInTheDocument()
    const kpis = screen.getByLabelText('What changed')
    expect(within(kpis).getByText('+312 lb')).toBeInTheDocument()
    expect(screen.getByText(/1 revised sheet has not been run yet/)).toBeInTheDocument()

    const card = screen.getByRole('region', { name: /S201 · p\.12 \(was S201 · p\.12\)/ })
    expect(within(card).getByText('Matched by sheet number')).toBeInTheDocument()
    const changed = within(card).getByRole('row', { name: /Changed W12X26.*W12X30.*size/ })
    expect(within(changed).getByRole('link', { name: 'Show on revised sheet' })).toHaveAttribute(
      'href',
      `/projects/${project.id}/pages/rev-12?member=r1`,
    )
    expect(within(card).getByRole('row', { name: /Removed W16X31.*−620 lb/ })).toBeInTheDocument()
    expect(within(card).getByRole('row', { name: /Added.*W21X44.*\+836 lb/ })).toBeInTheDocument()

    await userEvent.selectOptions(within(card).getByLabelText('Revises sheet'), '')
    await waitFor(() => expect(paired).toEqual({ revised_page: 'rev-12', original_page: null }))
  })

  it.each([
    ['pdf_unreadable', 'This file could not be read as a PDF. It may be damaged or incomplete.'],
    ['pdf_password_protected', 'This PDF is password-protected. Remove the password and upload it again.'],
  ])('explains a drawing that cannot be read (%s) instead of failing', async (code, message) => {
    const project = mockProjects.create('Structures', OWNER)
    mockBackend.startSession(OWNER)
    server.use(
      http.get('*/api/v1/drawing-sets/rev/revision/', () =>
        HttpResponse.json({ error: { code, message, details: {}, request_id: 'req-1' } }, { status: 409 }),
      ),
    )
    renderApp(`/projects/${project.id}/revisions/rev`)

    expect(await screen.findByRole('heading', { name: 'The drawings could not be compared' })).toBeInTheDocument()
    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to the project' })).toHaveAttribute('href', `/projects/${project.id}`)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument() // the file, not a fault: no error report
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument()
  })
})

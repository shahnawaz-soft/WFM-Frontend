import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { renderApp } from '../../test/renderApp'

const OWNER = 'estimator@steelo.test'

describe('Connection templates', () => {
  it('is reached from the main navigation', async () => {
    mockBackend.startSession(OWNER)
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: 'Connection templates' }))
    expect(await screen.findByRole('heading', { name: 'Connection templates' })).toBeInTheDocument()
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument()
  })

  it('creates a template of several lines, saying which line needs what', async () => {
    mockBackend.startSession(OWNER)
    renderApp('/connection-templates')
    await userEvent.click(await screen.findByRole('button', { name: '+ New template' }))
    const form = screen.getByRole('form', { name: 'New template' })
    await userEvent.type(within(form).getByLabelText('Template name'), 'Base plate')
    const first = within(form).getByRole('group', { name: 'Line 1' })
    await userEvent.type(within(first).getByLabelText('Material'), 'PL3/4X12')
    await userEvent.type(within(first).getByLabelText('Length each'), `1'-0"`)
    await userEvent.click(within(form).getByRole('button', { name: '+ Add line' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Save template' }))
    const second = within(form).getByRole('group', { name: 'Line 2' })
    expect(await within(second).findByText('Say what the material is.')).toBeInTheDocument()

    await userEvent.type(within(second).getByLabelText('Material'), '3/4" ANCHOR ROD')
    await userEvent.clear(within(second).getByLabelText('Pieces'))
    await userEvent.type(within(second).getByLabelText('Pieces'), '4')
    await userEvent.click(within(form).getByRole('button', { name: 'Save template' }))
    const card = await screen.findByRole('region', { name: 'Base plate' })
    const lines = within(card).getByRole('list', { name: 'Lines in Base plate' })
    expect(within(lines).getAllByRole('listitem').map((li) => li.textContent)).toEqual([`PL3/4X12 × 1'-0"`, '4 × 3/4" ANCHOR ROD'])
  })

  it('edits and deletes a template', async () => {
    mockBackend.startSession(OWNER)
    renderApp('/connection-templates')
    await userEvent.click(await screen.findByRole('button', { name: '+ New template' }))
    let form = screen.getByRole('form', { name: 'New template' })
    await userEvent.type(within(form).getByLabelText('Template name'), 'Clip')
    await userEvent.type(within(form).getByLabelText('Material'), 'L4X4X1/2')
    await userEvent.selectOptions(within(form).getByLabelText('Kind'), 'continuous')
    await userEvent.click(within(form).getByRole('button', { name: 'Save template' }))
    let card = await screen.findByRole('region', { name: 'Clip' })
    expect(within(card).getByText('L4X4X1/2, full member length')).toBeInTheDocument()

    await userEvent.click(within(card).getByRole('button', { name: 'Edit' }))
    form = within(card).getByRole('form', { name: 'Edit Clip' })
    await userEvent.clear(within(form).getByLabelText('Template name'))
    await userEvent.type(within(form).getByLabelText('Template name'), 'Ledger')
    await userEvent.click(within(form).getByRole('button', { name: 'Save template' }))
    card = await screen.findByRole('region', { name: 'Ledger' })

    await userEvent.click(within(card).getByRole('button', { name: 'Delete' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete template' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ledger' })).not.toBeInTheDocument())
    expect(screen.getByText(/No templates yet/)).toBeInTheDocument()
  })
})

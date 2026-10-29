import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { preloadRoutes, renderApp } from '../../test/renderApp'

beforeAll(() => preloadRoutes('/admin/users'))
beforeEach(() => mockBackend.startSession('admin@steelo.test'))

async function openUsers() {
  renderApp('/admin/users')
  return screen.findByRole('table')
}

describe('Users administration', () => {
  it('lists users with text status and marks the current user', async () => {
    const table = await openUsers()
    const adminRow = within(table).getByText('admin@steelo.test').closest('tr')!
    expect(within(adminRow).getByText('(you)')).toBeInTheDocument()
    expect(within(adminRow).getByText('Administrator')).toBeInTheDocument()
    expect(within(adminRow).getByText('Active')).toBeInTheDocument()
  })

  it('shows usernames, with a dash when a user has none', async () => {
    const table = await openUsers()
    const esha = within(table).getByText('estimator@steelo.test').closest('tr')!
    expect(within(esha).getByText('esha')).toBeInTheDocument()
    const admin = within(table).getByText('admin@steelo.test').closest('tr')!
    expect(within(admin).getByText('—')).toBeInTheDocument()
  })

  it('creates a user with a username who can sign in with it', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'site@steelo.test')
    await userEvent.type(within(dialog).getByLabelText('Username'), 'Site.Lead')
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'temporary-pass-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await screen.findByText('site.lead')).toBeInTheDocument()
    expect(mockBackend.userByEmail('site@steelo.test').username).toBe('site.lead')
  })

  it('shows a taken username next to the field', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Edit admin@steelo.test' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Username'), 'esha')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByText('This username is already taken.')).toBeInTheDocument()
  })

  it('filters by search text', async () => {
    await openUsers()
    await userEvent.type(screen.getByLabelText('Search'), 'esha')
    await within(screen.getByRole('table')).findByText('estimator@steelo.test')
    expect(await screen.findByText('1–1 of 1')).toBeInTheDocument()
  })

  it('shows an empty state when filters match nothing', async () => {
    await openUsers()
    await userEvent.type(screen.getByLabelText('Search'), 'nobody-here')
    expect(await screen.findByText('No users match these filters')).toBeInTheDocument()
  })

  it('creates a user', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'detailer@steelo.test')
    await userEvent.type(within(dialog).getByLabelText('First name'), 'Dev')
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'temporary-pass-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await screen.findByText('User created')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByText('detailer@steelo.test')).toBeInTheDocument()
  })

  it('shows server-side field errors in the create form', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'estimator@steelo.test')
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'temporary-pass-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))

    expect(await within(dialog).findByText('A user with this email already exists.')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('validates the temporary password length before submitting', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Add user' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add user' })
    await userEvent.type(within(dialog).getByLabelText('Email'), 'x@steelo.test')
    await userEvent.type(within(dialog).getByLabelText('Temporary password'), 'short')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }))
    expect(within(dialog).getByText('Use at least 10 characters.')).toBeInTheDocument()
  })

  it('changes a user role', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Edit estimator@steelo.test' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Role'), 'operator')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByText('User updated')).toBeInTheDocument()
    const row = (await screen.findByText('estimator@steelo.test')).closest('tr')!
    expect(await within(row).findByText('Operator')).toBeInTheDocument()
  })

  it('explains why an admin cannot deactivate themselves', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Edit admin@steelo.test' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.selectOptions(within(dialog).getByLabelText('Status'), 'false')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate user' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You cannot remove your own administrator access or deactivate yourself.',
    )
  })

  it('deletes a user after confirmation and can restore them', async () => {
    const table = await openUsers()
    expect(within(table).queryByRole('button', { name: 'Delete admin@steelo.test' })).not.toBeInTheDocument() // not yourself
    await userEvent.click(within(table).getByRole('button', { name: 'Delete estimator@steelo.test' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete estimator@steelo.test?' })
    expect(within(dialog).getByText(/can no longer sign in/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }))
    expect(await screen.findByText('User deleted')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('estimator@steelo.test')).not.toBeInTheDocument()) // list shows active users

    await userEvent.selectOptions(screen.getByLabelText('Status'), 'false')
    await userEvent.click(await screen.findByRole('button', { name: 'Restore estimator@steelo.test' }))
    expect(await screen.findByText('User restored')).toBeInTheDocument()
  })

  it('resets a password', async () => {
    await openUsers()
    await userEvent.click(screen.getByRole('button', { name: 'Reset password for estimator@steelo.test' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('New temporary password'), 'brand-new-pass-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Password reset')).toBeInTheDocument()
    expect(mockBackend.state.passwords.get('estimator@steelo.test')).toBe('brand-new-pass-1')
  })
})

import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { mockBackend, PASSWORD } from '../test/mockBackend'
import { renderApp } from '../test/renderApp'

beforeEach(() => mockBackend.startSession('estimator@steelo.test'))

function passwordForm() {
  return screen.getByRole('region', { name: 'Change password' })
}

describe('Profile', () => {
  it('updates the name and reflects it in the user menu', async () => {
    renderApp('/profile')
    const firstName = await screen.findByLabelText('First name')
    await userEvent.clear(firstName)
    await userEvent.type(firstName, 'Eshani')
    await userEvent.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByText('Profile saved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu for Eshani Estimator' })).toBeInTheDocument()
  })

  it('checks that new passwords match before calling the API', async () => {
    renderApp('/profile')
    await screen.findByRole('heading', { name: 'Change password' })
    const form = passwordForm()
    await userEvent.type(within(form).getByLabelText('Current password'), PASSWORD)
    await userEvent.type(within(form).getByLabelText('New password'), 'new-password-123')
    await userEvent.type(within(form).getByLabelText('Confirm new password'), 'different-123')
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }))
    expect(within(form).getByText('The new passwords do not match.')).toBeInTheDocument()
  })

  it('shows a wrong current password next to the field', async () => {
    renderApp('/profile')
    await screen.findByRole('heading', { name: 'Change password' })
    const form = passwordForm()
    await userEvent.type(within(form).getByLabelText('Current password'), 'not-my-password')
    await userEvent.type(within(form).getByLabelText('New password'), 'new-password-123')
    await userEvent.type(within(form).getByLabelText('Confirm new password'), 'new-password-123')
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }))
    expect(await within(form).findByText('Your current password is incorrect.')).toBeInTheDocument()
  })

  it('changes the password', async () => {
    renderApp('/profile')
    await screen.findByRole('heading', { name: 'Change password' })
    const form = passwordForm()
    await userEvent.type(within(form).getByLabelText('Current password'), PASSWORD)
    await userEvent.type(within(form).getByLabelText('New password'), 'new-password-123')
    await userEvent.type(within(form).getByLabelText('Confirm new password'), 'new-password-123')
    await userEvent.click(within(form).getByRole('button', { name: 'Change password' }))

    expect(await screen.findByText('Password changed')).toBeInTheDocument()
    expect(mockBackend.state.passwords.get('estimator@steelo.test')).toBe('new-password-123')
    expect(within(form).getByLabelText('Current password')).toHaveValue('')
  })
})

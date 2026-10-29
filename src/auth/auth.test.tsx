import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { fetchCurrentUser } from '../api/auth'
import { tokenStore } from './tokenStore'
import { mockBackend, PASSWORD } from '../test/mockBackend'
import { preloadRoutes, renderApp } from '../test/renderApp'

beforeAll(() => preloadRoutes('/admin/users'))

async function signIn(email: string, password = PASSWORD) {
  await userEvent.type(await screen.findByLabelText('Email or username'), email)
  await userEvent.type(screen.getByLabelText('Password'), password)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('Login', () => {
  it('sends anonymous users to the login page', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('signs in and shows the app with the user menu', async () => {
    renderApp('/')
    await signIn('estimator@steelo.test')
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Account menu for Esha Estimator' })).toBeInTheDocument()
  })

  it('signs in with a username, ignoring case', async () => {
    renderApp('/')
    await signIn('ESHA')
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
  })

  it('returns the user to the page they originally asked for', async () => {
    renderApp('/admin/users')
    await signIn('admin@steelo.test')
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument()
  })

  it('shows one generic error for bad credentials and clears the password', async () => {
    renderApp('/')
    await signIn('estimator@steelo.test', 'wrong-password')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email, username or password.')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('validates required fields before calling the API', async () => {
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('Enter your email or username.')).toBeInTheDocument()
    expect(screen.getByLabelText('Email or username')).toHaveAttribute('aria-invalid', 'true')
    expect(mockBackend.state.sessionUserId).toBeNull()
  })
})

describe('Session lifecycle', () => {
  it('restores an existing session on page load without asking to sign in', async () => {
    mockBackend.startSession('estimator@steelo.test')
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
  })

  it('renews an expired access token transparently and retries the request', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Projects' })
    const refreshesAfterBoot = mockBackend.state.refreshCalls

    mockBackend.expireAccessTokens()
    await userEvent.click(screen.getByRole('link', { name: 'Users' }))
    expect(await screen.findByText('estimator@steelo.test')).toBeInTheDocument()
    expect(mockBackend.state.refreshCalls).toBe(refreshesAfterBoot + 1)
  })

  it('shares one refresh between concurrent failing requests', async () => {
    mockBackend.startSession('admin@steelo.test')
    tokenStore.set('stale-token')
    await Promise.all([fetchCurrentUser(), fetchCurrentUser(), fetchCurrentUser()])
    expect(mockBackend.state.refreshCalls).toBe(1)
  })

  it('signs the user out with an explanation when the session cannot be renewed', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Projects' })

    mockBackend.expireAccessTokens()
    mockBackend.endSession()
    await userEvent.click(screen.getByRole('link', { name: 'Users' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your session has expired')
  })

  it('signs out from the user menu', async () => {
    mockBackend.startSession('estimator@steelo.test')
    renderApp('/')
    await userEvent.click(await screen.findByRole('button', { name: /Account menu/ }))
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('estimator@steelo.test')).toBeInTheDocument()
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Sign out' }))

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(mockBackend.state.sessionUserId).toBeNull())
  })
})

describe('Permission-aware navigation', () => {
  it('hides admin navigation from members and blocks direct access', async () => {
    mockBackend.startSession('estimator@steelo.test')
    const { router } = renderApp('/')
    await screen.findByRole('heading', { level: 1, name: 'Projects' })
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument()

    await router.navigate('/admin/users')
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument()
  })

  it('shows admin navigation to administrators', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/')
    expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument()
  })
})

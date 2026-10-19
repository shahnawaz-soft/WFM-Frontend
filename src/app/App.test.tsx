import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it } from 'vitest'

import { mockBackend } from '../test/mockBackend'
import { server } from '../test/server'
import { renderApp } from '../test/renderApp'

beforeEach(() => mockBackend.startSession('admin@steelo.test'))

describe('App shell', () => {
  it('renders the shell with skip link, navigation and main landmark', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome, Ada' })).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/no/such/page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the home page' })).toBeInTheDocument()
  })
})

describe('System status (loading, success, degraded, error states)', () => {
  it('shows loading, then every dependency with text labels (not colour only)', async () => {
    renderApp()
    expect(await screen.findByText('Checking the Steelo server…')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: 'Dependency checks' })
    expect(await screen.findByText('Operational')).toBeInTheDocument()
    expect(within(list).getByText('Database').nextSibling).toHaveTextContent('OK')
    expect(within(list).getByText('Background job queue')).toBeInTheDocument()
  })

  it('shows a degraded state when the backend reports a failed dependency (503)', async () => {
    server.use(
      http.get('*/health/ready', () =>
        HttpResponse.json(
          { status: 'error', version: 'test', checks: { database: 'ok', redis: 'error' } },
          { status: 503 },
        ),
      ),
    )
    renderApp()
    expect(await screen.findByText('Degraded')).toBeInTheDocument()
    expect(screen.getByText('Background job queue').nextSibling).toHaveTextContent('Unavailable')
  })

  it('shows an error state with reference id and a working retry', async () => {
    let calls = 0
    server.use(
      http.get('*/health/ready', () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json(
            { error: { code: 'internal_error', message: 'Server exploded.', details: {}, request_id: 'req-42' } },
            { status: 500 },
          )
        }
        return HttpResponse.json({ status: 'ok', version: 'test', checks: { database: 'ok' } })
      }),
    )
    renderApp()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Server unreachable')).toBeInTheDocument()
    expect(within(alert).getByText('Server exploded.')).toBeInTheDocument()
    expect(within(alert).getByText('req-42')).toBeInTheDocument()

    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Operational')).toBeInTheDocument()
  })

  it('confirms a manual re-check with a success notification', async () => {
    renderApp()
    await screen.findByText('Operational')
    await userEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('All systems are running')).toBeInTheDocument()
  })
})

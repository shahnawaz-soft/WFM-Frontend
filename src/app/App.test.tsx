import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { mockBackend } from '../test/mockBackend'
import { renderApp } from '../test/renderApp'

beforeEach(() => mockBackend.startSession('admin@steelo.test'))

describe('App shell', () => {
  it('renders the shell with skip link, navigation and main landmark', async () => {
    renderApp()
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })

  it('shows a not-found page for unknown routes', async () => {
    renderApp('/no/such/page')
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Projects' })).toBeInTheDocument()
  })
})

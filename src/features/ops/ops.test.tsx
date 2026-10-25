import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'

import { mockBackend } from '../../test/mockBackend'
import { preloadRoutes, renderApp } from '../../test/renderApp'

beforeAll(() => preloadRoutes('/ops'))

describe('Operations', () => {
  it('shows health, recent jobs and failures to administrators', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: 'Operations' }))
    expect(await screen.findByText('All services up')).toBeInTheDocument()
    const jobs = screen.getByLabelText('Jobs in the last 24 hours')
    expect(within(jobs).getByText('Failed').nextSibling).toHaveTextContent('1')
    expect(screen.getByText('processing_error')).toBeInTheDocument()
    expect(screen.getByText(/14 member corrections · 2 rejections/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Show failed jobs' }))
    const table = await screen.findByRole('table', { name: /Processing jobs/ })
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2))
    expect(within(table).getByText(/Processing failed unexpectedly/)).toBeInTheDocument()
    expect(within(table).getByText(/attempt 2/)).toBeInTheDocument()
  })

  it('lists completed jobs with their result', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/ops?tab=jobs')
    const table = await screen.findByRole('table', { name: /Processing jobs/ })
    expect(within(table).getByText(/151 members, 28 columns/)).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: /Warehouse · p.3 GA.pdf/ })).toBeInTheDocument()
  })

  it('shows the audit log across projects', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/ops?tab=audit')
    const table = await screen.findByRole('table', { name: /Audit events/ })
    expect(within(table).getByText('member.edited')).toBeInTheDocument()
    expect(within(table).getByText(/Two bays/)).toBeInTheDocument()
  })

  it('is not for ordinary members', async () => {
    mockBackend.startSession('estimator@steelo.test')
    renderApp('/ops')
    expect(await screen.findByRole('heading', { name: 'You don’t have access to this page' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument()
  })
})

describe('Metrics', () => {
  it('shows the PRD success metrics', async () => {
    mockBackend.startSession('admin@steelo.test')
    renderApp('/ops?tab=metrics')
    const time = await screen.findByRole('region', { name: 'Time to output (median)' })
    expect(within(time).getByText('3.5 h')).toBeInTheDocument()
    expect(within(time).getByText('2.2 days')).toBeInTheDocument()
    expect(within(time).getByText('18.5 min')).toBeInTheDocument()
    const completion = screen.getByRole('region', { name: 'Completion' })
    expect(within(completion).getByText('50%')).toBeInTheDocument()
    expect(within(completion).getByText(/1 of 2 projects .* \(target 85%\)/)).toBeInTheDocument()
    expect(screen.getByText(/baseline time study/)).toBeInTheDocument()
  })
})

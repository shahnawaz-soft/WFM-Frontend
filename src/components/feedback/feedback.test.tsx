import { QueryClientProvider, useMutation } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ApiError } from '../../api/errors'
import { createTestQueryClient } from '../../test/renderApp'
import { ErrorBoundary } from './ErrorBoundary'
import { Toaster } from './Toaster'
import { notify } from './toastStore'

describe('Toaster', () => {
  it('announces the tone in text and can be dismissed', async () => {
    render(<Toaster />)
    notify.error('Upload failed', 'File is too large.')
    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
    expect(screen.getByText('Error:')).toBeInTheDocument()
    expect(screen.getByText('File is too large.')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })
})

describe('Global mutation error handling', () => {
  function Harness({ suppress = false }: { suppress?: boolean }) {
    const mutation = useMutation({
      mutationFn: async () => {
        throw new ApiError({ status: 409, code: 'page_busy', message: 'Page is already processing.' })
      },
      meta: { suppressErrorToast: suppress },
    })
    return <button onClick={() => mutation.mutate()}>Run</button>
  }

  function renderHarness(suppress?: boolean) {
    render(
      <QueryClientProvider client={createTestQueryClient()}>
        <Harness suppress={suppress} />
        <Toaster />
      </QueryClientProvider>,
    )
  }

  it('shows the API error message as a notification', async () => {
    renderHarness()
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(await screen.findByText('Action failed')).toBeInTheDocument()
    expect(screen.getByText('Page is already processing.')).toBeInTheDocument()
  })

  it('stays quiet when the form handles the error inline', async () => {
    renderHarness(true)
    await userEvent.click(screen.getByRole('button', { name: 'Run' }))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Action failed')).not.toBeInTheDocument()
  })
})

describe('ErrorBoundary', () => {
  it('replaces a crashed view with a recoverable message', async () => {
    let shouldThrow = true
    function Fragile() {
      if (shouldThrow) throw new Error('render failure')
      return <p>Recovered view</p>
    }
    render(
      <ErrorBoundary>
        <Fragile />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('This screen failed to load')
    expect(screen.queryByText('render failure')).not.toBeInTheDocument()

    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('Recovered view')).toBeInTheDocument()
  })
})

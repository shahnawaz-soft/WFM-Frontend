import type { ReactNode } from 'react'

import type { ApiError } from '../../api/errors'
import { Button } from '../ui/Button'
import { StatusIcon } from '../ui/StatusIcon'
import { Spinner } from './Spinner'

/** Standard loading / error / empty states, used by every data view (PRD §5). */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <Spinner label="" />
      <p>{label}</p>
    </div>
  )
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
}: {
  title?: string
  error: ApiError | Error
  onRetry?: () => void
}) {
  const requestId = 'requestId' in error ? error.requestId : null
  return (
    <div className="state state--error" role="alert">
      <StatusIcon tone="error" />
      <div>
        <h2 className="state__title">{title}</h2>
        <p>{error.message}</p>
        {requestId && (
          <p className="state__meta">
            Reference: <code>{requestId}</code>
          </p>
        )}
        {onRetry && (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    </div>
  )
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="state state--empty">
      <h2 className="state__title">{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

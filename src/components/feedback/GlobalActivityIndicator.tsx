import { useIsFetching, useIsMutating } from '@tanstack/react-query'

/** Thin progress bar while any request is in flight; announced once to screen readers. */
export function GlobalActivityIndicator() {
  const busy = useIsFetching() + useIsMutating() > 0
  return (
    <div className="activity-bar" data-active={busy} aria-hidden={!busy}>
      <span className="visually-hidden" role="status">
        {busy ? 'Loading' : ''}
      </span>
    </div>
  )
}

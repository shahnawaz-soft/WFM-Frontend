import { Component, type ErrorInfo, type ReactNode } from 'react'

import { Button } from '../ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/** Last-resort catch for render errors, so one broken view never blanks the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Error tracking (Sentry, OD-22) hooks in here later. Never swallow silently.
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="state state--error fatal-error" role="alert">
        <div>
          <h1 className="state__title">This screen failed to load</h1>
          <p>An unexpected error occurred. Your saved project data is not affected.</p>
          <div className="button-row">
            <Button variant="primary" onClick={() => this.setState({ error: null })}>
              Try again
            </Button>
            <Button onClick={() => window.location.reload()}>Reload page</Button>
          </div>
        </div>
      </div>
    )
  }
}

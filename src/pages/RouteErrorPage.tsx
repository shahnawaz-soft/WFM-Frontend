import { isRouteErrorResponse, Link, useRouteError } from 'react-router'

/** Shown when a route fails to render or load. Logs the error; never shows a blank page. */
export function RouteErrorPage() {
  const error = useRouteError()
  console.error('Route error', error)
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : 'An unexpected error occurred while showing this page.'

  return (
    <main className="app-main">
      <div className="state state--error" role="alert">
        <div>
          <h1 className="state__title">Something went wrong</h1>
          <p>{message}</p>
          <Link to="/projects">Go to Projects</Link>
        </div>
      </div>
    </main>
  )
}

import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <div className="state state--empty">
      <h1 className="state__title">Page not found</h1>
      <p>The page you asked for does not exist or has moved.</p>
      <Link to="/">Go to the home page</Link>
    </div>
  )
}

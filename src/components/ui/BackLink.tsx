import { Link } from 'react-router'

/** A visible way out of a sub-page (breadcrumbs alone are easy to miss). */
export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link className="button button--secondary back-link" to={to}>
      <span aria-hidden="true">←</span> {label}
    </Link>
  )
}

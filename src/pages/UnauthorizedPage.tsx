import { Link } from 'react-router'

import { StatusIcon } from '../components/ui/StatusIcon'

export function UnauthorizedPage() {
  return (
    <div className="state state--error">
      <StatusIcon tone="warning" />
      <div>
        <h1 className="state__title">You don’t have access to this page</h1>
        <p>Your account does not have permission to view it. If you need access, ask your Steelo administrator.</p>
        <Link to="/">Go to the home page</Link>
      </div>
    </div>
  )
}

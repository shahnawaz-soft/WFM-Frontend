import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router'

import type { Capability } from '../api/types'
import { useAuth } from './AuthContext'

/** Routes below require a signed-in user; others are sent to /login and brought back. */
export function RequireAuth() {
  const { status } = useAuth()
  const location = useLocation()
  if (status !== 'authenticated') {
    const from = location.pathname + location.search
    return <Navigate to="/login" replace state={{ from }} />
  }
  return <Outlet />
}

/** Hides a route from users without the capability (the API enforces it independently). */
export function RequireCapability({
  capability,
  children,
}: {
  capability: Capability
  children: ReactNode
}) {
  const { can } = useAuth()
  if (!can(capability)) return <Navigate to="/unauthorized" replace />
  return <>{children}</>
}

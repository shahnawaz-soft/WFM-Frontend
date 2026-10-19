import { createContext, useContext } from 'react'

import type { Capability, CurrentUser } from '../api/types'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous'

export interface AuthContextValue {
  status: AuthStatus
  user: CurrentUser | null
  /** Why the user was signed out, shown once on the login page. */
  signOutReason: 'expired' | null
  signIn: (login: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  setUser: (user: CurrentUser) => void
  can: (capability: Capability) => boolean
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}

import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import * as authApi from '../api/auth'
import type { Capability, CurrentUser } from '../api/types'
import { LoadingState } from '../components/feedback/States'
import { AuthContext, type AuthContextValue, type AuthStatus } from './AuthContext'
import { tokenStore } from './tokenStore'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUserState] = useState<CurrentUser | null>(null)
  const [signOutReason, setSignOutReason] = useState<'expired' | null>(null)

  const becomeAnonymous = useCallback(
    (reason: 'expired' | null) => {
      tokenStore.set(null)
      queryClient.clear() // no previous user's data may linger in the cache
      setUserState(null)
      setSignOutReason(reason)
      setStatus('anonymous')
    },
    [queryClient],
  )

  // Restore an existing session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false
    authApi
      .restoreSession()
      .then((restored) => {
        if (cancelled) return
        setUserState(restored)
        setStatus('authenticated')
      })
      .catch(() => {
        if (!cancelled) becomeAnonymous(null)
      })
    return () => {
      cancelled = true
    }
  }, [becomeAnonymous])

  // The API client signals when a session can no longer be renewed.
  useEffect(() => tokenStore.onExpire(() => becomeAnonymous('expired')), [becomeAnonymous])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      signOutReason,
      signIn: async (login, password) => {
        const session = await authApi.login(login, password)
        setUserState(session.user)
        setSignOutReason(null)
        setStatus('authenticated')
      },
      signOut: async () => {
        try {
          await authApi.logout()
        } finally {
          becomeAnonymous(null)
        }
      },
      setUser: setUserState,
      can: (capability: Capability) => user?.capabilities.includes(capability) ?? false,
    }),
    [status, user, signOutReason, becomeAnonymous],
  )

  if (status === 'loading') {
    return (
      <main className="app-main">
        <LoadingState label="Checking your session…" />
      </main>
    )
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

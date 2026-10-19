import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'

import { useAuth } from '../auth/AuthContext'
import { Button } from '../components/ui/Button'
import { FormAlert, TextField } from '../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../lib/formErrors'
import { safeDestination } from '../lib/safeDestination'

export function LoginPage() {
  const { status, signIn, signOutReason } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const destination = safeDestination((location.state as { from?: unknown } | null)?.from)

  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [submitting, setSubmitting] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (errors.form) alertRef.current?.focus()
  }, [errors])

  if (status === 'authenticated') return <Navigate to={destination} replace />

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const fields: Record<string, string[]> = {}
    if (!login.trim()) fields.login = ['Enter your email or username.']
    if (!password) fields.password = ['Enter your password.']
    if (Object.keys(fields).length) {
      setErrors({ fields, form: null })
      return
    }
    setSubmitting(true)
    setErrors(NO_ERRORS)
    try {
      await signIn(login.trim(), password)
      navigate(destination, { replace: true })
    } catch (error) {
      setErrors(toFormErrors(error))
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main id="main" className="auth-page">
      <div className="auth-card">
        <div className="auth-card__logo">
          <img src="/SO_logo.png" alt="Structures Online — Structural Steel Detailing" width="1080" height="208" />
        </div>
        <p className="auth-card__brand">Steelo</p>
        <h1>Sign in</h1>
        {signOutReason === 'expired' && !errors.form && (
          <p className="notice" role="status">
            Your session has expired. Please sign in again.
          </p>
        )}
        <div ref={alertRef} tabIndex={-1}>
          <FormAlert message={errors.form} />
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <TextField
            label="Email or username"
            type="text"
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            error={errors.fields.login}
            required
            autoFocus
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.fields.password}
            required
          />
          <Button type="submit" variant="primary" loading={submitting} className="button--block">
            Sign in
          </Button>
        </form>
        <p className="muted auth-card__help">
          Accounts are created by your Steelo administrator. Contact them if you cannot sign in.
        </p>
      </div>
    </main>
  )
}

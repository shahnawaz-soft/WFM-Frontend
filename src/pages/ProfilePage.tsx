import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { changePassword, updateProfile } from '../api/auth'
import { GLOBAL_ROLE_LABELS } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { notify } from '../components/feedback/toastStore'
import { Button } from '../components/ui/Button'
import { FormAlert, TextField } from '../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../lib/formErrors'

export function ProfilePage() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <>
      <h1>Profile</h1>
      <p className="muted">
        {user.email} · {GLOBAL_ROLE_LABELS[user.global_role]}
      </p>
      <div className="two-column">
        <ProfileForm />
        <PasswordForm />
      </div>
    </>
  )
}

function ProfileForm() {
  const { user, setUser } = useAuth()
  const [firstName, setFirstName] = useState(user?.first_name ?? '')
  const [lastName, setLastName] = useState(user?.last_name ?? '')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)

  const mutation = useMutation({
    mutationFn: updateProfile,
    meta: { suppressErrorToast: true, successMessage: 'Profile saved' },
    onSuccess: (updated) => {
      setUser(updated)
      setErrors(NO_ERRORS)
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    mutation.mutate({ first_name: firstName.trim(), last_name: lastName.trim() })
  }

  return (
    <section className="card" aria-labelledby="profile-heading">
      <h2 id="profile-heading">Your details</h2>
      <FormAlert message={errors.form} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="First name"
          autoComplete="given-name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          error={errors.fields.first_name}
          maxLength={150}
        />
        <TextField
          label="Last name"
          autoComplete="family-name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          error={errors.fields.last_name}
          maxLength={150}
        />
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Save details
        </Button>
      </form>
    </section>
  )
}

function PasswordForm() {
  const { setUser } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)

  const mutation = useMutation({
    mutationFn: () => changePassword(current, next),
    meta: { suppressErrorToast: true },
    onSuccess: (session) => {
      setUser(session.user)
      setCurrent('')
      setNext('')
      setConfirm('')
      setErrors(NO_ERRORS)
      notify.success('Password changed', 'You have been signed out on your other devices.')
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const fields: Record<string, string[]> = {}
    if (!current) fields.current_password = ['Enter your current password.']
    if (next.length < 10) fields.new_password = ['Use at least 10 characters.']
    if (next !== confirm) fields.confirm_password = ['The new passwords do not match.']
    if (Object.keys(fields).length) {
      setErrors({ fields, form: null })
      return
    }
    mutation.mutate()
  }

  return (
    <section className="card" aria-labelledby="password-heading">
      <h2 id="password-heading">Change password</h2>
      <FormAlert message={errors.form} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={errors.fields.current_password}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters. Avoid common or all-number passwords."
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={errors.fields.new_password}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.fields.confirm_password}
        />
        <Button type="submit" variant="primary" loading={mutation.isPending}>
          Change password
        </Button>
      </form>
    </section>
  )
}

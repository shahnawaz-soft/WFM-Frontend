import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { createUser, resetUserPassword, updateUser } from '../../api/users'
import { GLOBAL_ROLE_LABELS, type GlobalRole, type User } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'

const EMPTY_CREATE_FORM = { email: '', username: '', first_name: '', last_name: '', global_role: 'member', password: '' }

const USERNAME_HINT =
  'Optional. Lets the user sign in with this instead of their email. 3–30 letters, numbers, dots, underscores or hyphens.'

const ROLE_OPTIONS = Object.entries(GLOBAL_ROLE_LABELS).map(([value, label]) => ({ value, label }))

function useUserMutation<TArgs>(fn: (args: TArgs) => Promise<unknown>, onDone: () => void, success: string) {
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const mutation = useMutation({
    mutationFn: fn,
    meta: { suppressErrorToast: true, successMessage: success },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      onDone()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  return { mutation, errors, setErrors }
}

export function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY_CREATE_FORM)
  const { mutation, errors, setErrors } = useUserMutation(
    () => createUser({ ...form, global_role: form.global_role as GlobalRole }),
    () => close(),
    'User created',
  )
  function close() {
    setForm(EMPTY_CREATE_FORM)
    setErrors(NO_ERRORS)
    onClose()
  }
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const fields: Record<string, string[]> = {}
    if (!form.email.trim()) fields.email = ['Enter an email address.']
    if (form.password.length < 10) fields.password = ['Use at least 10 characters.']
    if (Object.keys(fields).length) return setErrors({ fields, form: null })
    mutation.mutate(undefined)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Add user"
      description="The user signs in with this email and the temporary password. Share it securely and ask them to change it."
    >
      <FormAlert message={errors.form} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField label="Email" type="email" value={form.email} onChange={set('email')} error={errors.fields.email} required />
        <TextField
          label="Username"
          autoCapitalize="none"
          spellCheck={false}
          hint={USERNAME_HINT}
          value={form.username}
          onChange={set('username')}
          error={errors.fields.username}
          maxLength={30}
        />
        <div className="field-row">
          <TextField label="First name" value={form.first_name} onChange={set('first_name')} error={errors.fields.first_name} />
          <TextField label="Last name" value={form.last_name} onChange={set('last_name')} error={errors.fields.last_name} />
        </div>
        <SelectField label="Role" options={ROLE_OPTIONS} value={form.global_role} onChange={set('global_role')} error={errors.fields.global_role} />
        <TextField
          label="Temporary password"
          type="password"
          autoComplete="new-password"
          hint="At least 10 characters."
          value={form.password}
          onChange={set('password')}
          error={errors.fields.password}
          required
        />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create user
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

export function EditUserDialog({ user, isSelf, onClose }: { user: User; isSelf: boolean; onClose: () => void }) {
  const [form, setForm] = useState({
    username: user.username ?? '',
    first_name: user.first_name ?? '',
    last_name: user.last_name ?? '',
    global_role: user.global_role as string,
    is_active: user.is_active ? 'true' : 'false',
  })
  const { mutation, errors } = useUserMutation(
    () =>
      updateUser(user.id, {
        username: form.username.trim(),
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        global_role: form.global_role as GlobalRole,
        is_active: form.is_active === 'true',
      }),
    onClose,
    'User updated',
  )
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))
  const deactivating = user.is_active && form.is_active === 'false'

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit ${user.email}`}>
      <FormAlert message={errors.form} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          mutation.mutate(undefined)
        }}
        noValidate
      >
        <TextField
          label="Username"
          autoCapitalize="none"
          spellCheck={false}
          hint="Optional. Clear it to remove the username."
          value={form.username}
          onChange={set('username')}
          error={errors.fields.username}
          maxLength={30}
        />
        <div className="field-row">
          <TextField label="First name" value={form.first_name} onChange={set('first_name')} error={errors.fields.first_name} />
          <TextField label="Last name" value={form.last_name} onChange={set('last_name')} error={errors.fields.last_name} />
        </div>
        <SelectField
          label="Role"
          options={ROLE_OPTIONS}
          value={form.global_role}
          onChange={set('global_role')}
          error={errors.fields.global_role}
          hint={isSelf ? 'You cannot remove your own administrator access.' : undefined}
        />
        <SelectField
          label="Status"
          options={[
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Deactivated' },
          ]}
          value={form.is_active}
          onChange={set('is_active')}
          error={errors.fields.is_active}
          hint={deactivating ? 'Deactivating signs this user out everywhere. Their history is kept.' : undefined}
        />
        <div className="button-row">
          <Button type="submit" variant={deactivating ? 'danger' : 'primary'} loading={mutation.isPending}>
            {deactivating ? 'Deactivate user' : 'Save changes'}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

export function ResetPasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const { mutation, errors, setErrors } = useUserMutation(
    () => resetUserPassword(user.id, password),
    onClose,
    'Password reset',
  )

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Reset password for ${user.email}`}
      description="The user is signed out everywhere and must use this temporary password. Share it securely."
    >
      <FormAlert message={errors.form} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (password.length < 10) return setErrors({ fields: { new_password: ['Use at least 10 characters.'] }, form: null })
          mutation.mutate(undefined)
        }}
        noValidate
      >
        <TextField
          label="New temporary password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.fields.new_password}
        />
        <div className="button-row">
          <Button type="submit" variant="danger" loading={mutation.isPending}>
            Reset password
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

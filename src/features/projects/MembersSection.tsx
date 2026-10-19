import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { addMember, changeMemberRole, listMembers, lookupUsers, removeMember } from '../../api/projects'
import { toApiError } from '../../api/errors'
import {
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  type Membership,
  type Project,
  type ProjectRole,
  type UserLookup,
} from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { projectCan } from './useProjectPermissions'

const ROLE_OPTIONS = PROJECT_ROLES.map((r) => ({ value: r.value, label: `${r.label} — ${r.description}` }))

function useInvalidateProject(projectId: string) {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
    ])
}

export function MembersSection({ project }: { project: Project }) {
  const { user: me } = useAuth()
  const canManage = projectCan(project, 'project.manage_members')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Membership | null>(null)
  const query = useQuery({ queryKey: ['project', project.id, 'members'], queryFn: () => listMembers(project.id) })

  return (
    <section className="card" aria-labelledby="members-heading">
      <div className="card__header">
        <h2 id="members-heading">Members</h2>
        {canManage && (
          <Button variant="primary" onClick={() => setAdding(true)}>
            Add member
          </Button>
        )}
      </div>

      {query.isPending && <LoadingState label="Loading members…" />}
      {query.error && <ErrorState title="Could not load members" error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <div className="table-wrap">
          <table className="table">
            <caption className="visually-hidden">Project members</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Email</th>
                <th scope="col">Project role</th>
                <th scope="col">Added</th>
                {canManage && (
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {query.data.map((membership) => (
                <tr key={membership.id}>
                  <td>
                    {membership.user.full_name}
                    {membership.user.id === me?.id && <span className="muted"> (you)</span>}
                    {!membership.user.is_active && <span className="muted"> (deactivated)</span>}
                  </td>
                  <td>{membership.user.email}</td>
                  <td>
                    {canManage ? (
                      <RoleSelect project={project} membership={membership} />
                    ) : (
                      PROJECT_ROLE_LABELS[membership.role]
                    )}
                  </td>
                  <td>{new Date(membership.created_at).toLocaleDateString()}</td>
                  {canManage && (
                    <td className="table__actions">
                      <Button onClick={() => setRemoving(membership)} aria-label={`Remove ${membership.user.email}`}>
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddMemberDialog
          project={project}
          existing={new Set(query.data?.map((m) => m.user.id))}
          onClose={() => setAdding(false)}
        />
      )}
      {removing && <RemoveMemberDialog project={project} membership={removing} onClose={() => setRemoving(null)} />}
    </section>
  )
}

function RoleSelect({ project, membership }: { project: Project; membership: Membership }) {
  const invalidate = useInvalidateProject(project.id)
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (role: ProjectRole) => changeMemberRole(project.id, membership.id, role),
    meta: { successMessage: 'Role updated' },
    onSettled: async () => {
      // On failure (e.g. last owner) the select snaps back to the stored role.
      await queryClient.invalidateQueries({ queryKey: ['project', project.id, 'members'] })
      await invalidate()
    },
  })
  return (
    <select
      className="field__control field__control--compact"
      aria-label={`Project role for ${membership.user.email}`}
      value={membership.role}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as ProjectRole)}
    >
      {PROJECT_ROLES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  )
}

function AddMemberDialog({
  project,
  existing,
  onClose,
}: {
  project: Project
  existing: Set<string>
  onClose: () => void
}) {
  const invalidate = useInvalidateProject(project.id)
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<UserLookup | null>(null)
  const [role, setRole] = useState<ProjectRole>('editor')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const debounced = useDebouncedValue(search.trim())

  const results = useQuery({
    queryKey: ['users', 'lookup', debounced],
    queryFn: () => lookupUsers(debounced),
    enabled: debounced.length >= 2,
  })
  const candidates = (results.data ?? []).filter((u) => !existing.has(u.id))

  const mutation = useMutation({
    mutationFn: () => addMember(project.id, selected!.id, role),
    meta: { suppressErrorToast: true, successMessage: 'Member added' },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['project', project.id, 'members'] })
      await invalidate()
      onClose()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!selected) return setErrors({ fields: { user: ['Choose a person to add.'] }, form: null })
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add member" description={`Give a colleague access to “${project.name}”.`}>
      <FormAlert message={errors.form ?? errors.fields.user_id?.join(' ') ?? null} />
      <form onSubmit={handleSubmit} noValidate>
        {selected ? (
          <div className="field">
            <span className="field__label">Person</span>
            <div className="selected-person">
              <span>
                <strong>{selected.full_name}</strong> <span className="muted">{selected.email}</span>
              </span>
              <Button onClick={() => setSelected(null)}>Change</Button>
            </div>
          </div>
        ) : (
          <>
            <TextField
              label="Find a person"
              type="search"
              placeholder="Name, email or username"
              hint="Type at least 2 characters."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              error={errors.fields.user}
              autoFocus
            />
            {debounced.length >= 2 && (
              <div className="lookup-results" aria-live="polite">
                {results.isFetching && !results.data && <p className="muted">Searching…</p>}
                {results.data && candidates.length === 0 && (
                  <p className="muted">No one found who isn’t already a member.</p>
                )}
                {candidates.length > 0 && (
                  <ul aria-label="Matching people">
                    {candidates.map((u) => (
                      <li key={u.id}>
                        <button
                          type="button"
                          className="lookup-results__option"
                          onClick={() => {
                            setSelected(u)
                            setErrors(NO_ERRORS)
                          }}
                        >
                          <strong>{u.full_name}</strong> <span className="muted">{u.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
        <SelectField
          label="Project role"
          options={ROLE_OPTIONS}
          value={role}
          onChange={(e) => setRole(e.target.value as ProjectRole)}
          error={errors.fields.role}
        />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Add member
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

function RemoveMemberDialog({
  project,
  membership,
  onClose,
}: {
  project: Project
  membership: Membership
  onClose: () => void
}) {
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidate = useInvalidateProject(project.id)
  const isSelf = membership.user.id === me?.id

  const mutation = useMutation({
    mutationFn: () => removeMember(project.id, membership.id),
    meta: { suppressErrorToast: true, successMessage: isSelf ? 'You left the project' : 'Member removed' },
    onSuccess: async () => {
      onClose()
      if (isSelf) {
        queryClient.removeQueries({ queryKey: ['project', project.id] })
        await queryClient.invalidateQueries({ queryKey: ['projects'] })
        navigate('/projects')
        return
      }
      await queryClient.invalidateQueries({ queryKey: ['project', project.id, 'members'] })
      await invalidate()
    },
  })

  return (
    <ConfirmDialog
      open
      title={isSelf ? 'Leave this project?' : `Remove ${membership.user.full_name}?`}
      confirmLabel={isSelf ? 'Leave project' : 'Remove member'}
      pending={mutation.isPending}
      error={mutation.error ? toApiError(mutation.error).message : null}
      onConfirm={() => mutation.mutate()}
      onCancel={onClose}
    >
      <p>
        {isSelf
          ? 'You will lose access to this project unless someone adds you again.'
          : `${membership.user.email} will lose access to “${project.name}”. Their past changes stay in the project history.`}
      </p>
    </ConfirmDialog>
  )
}

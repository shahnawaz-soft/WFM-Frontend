import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { listUsers } from '../../api/users'
import { GLOBAL_ROLE_LABELS, type User } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { CreateUserDialog, EditUserDialog, ResetPasswordDialog } from './UserDialogs'

const PAGE_SIZE = 25

const ROLE_FILTER = [
  { value: '', label: 'All roles' },
  ...Object.entries(GLOBAL_ROLE_LABELS).map(([value, label]) => ({ value, label })),
]
const STATUS_FILTER = [
  { value: '', label: 'All statuses' },
  { value: 'true', label: 'Active' },
  { value: 'false', label: 'Deactivated' },
]

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; user: User }
  | { kind: 'reset'; user: User }
  | null

export function UsersPage() {
  const { user: me } = useAuth()
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [active, setActive] = useState('')
  const [offset, setOffset] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(null)
  const debouncedSearch = useDebouncedValue(search.trim())

  const filters = { search: debouncedSearch, global_role: role, is_active: active, limit: PAGE_SIZE, offset }
  const query = useQuery({
    queryKey: ['users', filters],
    queryFn: () => listUsers(filters),
    placeholderData: keepPreviousData,
  })

  const resetPaging = <T,>(setter: (v: T) => void) => (value: T) => {
    setter(value)
    setOffset(0)
  }
  const hasFilters = Boolean(debouncedSearch || role || active)
  const total = query.data?.count ?? 0

  return (
    <>
      <div className="page-header">
        <h1>Users</h1>
        <Button variant="primary" onClick={() => setDialog({ kind: 'create' })}>
          Add user
        </Button>
      </div>

      <div className="filters" role="search" aria-label="Filter users">
        <TextField
          label="Search"
          type="search"
          placeholder="Name, email or username"
          value={search}
          onChange={(e) => resetPaging(setSearch)(e.target.value)}
        />
        <SelectField label="Role" options={ROLE_FILTER} value={role} onChange={(e) => resetPaging(setRole)(e.target.value)} />
        <SelectField
          label="Status"
          options={STATUS_FILTER}
          value={active}
          onChange={(e) => resetPaging(setActive)(e.target.value)}
        />
      </div>

      {query.isPending && <LoadingState label="Loading users…" />}
      {query.error && !query.data && (
        <ErrorState title="Could not load users" error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data && query.data.results.length === 0 && (
        <EmptyState title={hasFilters ? 'No users match these filters' : 'No users yet'}>
          {hasFilters ? 'Try a different search or clear the filters.' : 'Add the first user to get started.'}
        </EmptyState>
      )}

      {query.data && query.data.results.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">
                Users, {total} total. Showing {offset + 1} to {offset + query.data.results.length}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Username</th>
                  <th scope="col">Role</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {query.data.results.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {user.full_name}
                      {user.id === me?.id && <span className="muted"> (you)</span>}
                    </td>
                    <td>{user.email}</td>
                    <td>{user.username || <span className="muted">—</span>}</td>
                    <td>{GLOBAL_ROLE_LABELS[user.global_role]}</td>
                    <td>
                      <StatusBadge
                        tone={user.is_active ? 'success' : 'neutral'}
                        label={user.is_active ? 'Active' : 'Deactivated'}
                      />
                    </td>
                    <td>{user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</td>
                    <td className="table__actions">
                      <Button onClick={() => setDialog({ kind: 'edit', user })} aria-label={`Edit ${user.email}`}>
                        Edit
                      </Button>
                      <Button
                        onClick={() => setDialog({ kind: 'reset', user })}
                        aria-label={`Reset password for ${user.email}`}
                      >
                        Reset password
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="pagination" aria-label="Users pages">
            <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
              Previous
            </Button>
            <span aria-live="polite">
              {offset + 1}–{offset + query.data.results.length} of {total}
            </span>
            <Button disabled={!query.data.next} onClick={() => setOffset(offset + PAGE_SIZE)}>
              Next
            </Button>
          </nav>
        </>
      )}

      <CreateUserDialog open={dialog?.kind === 'create'} onClose={() => setDialog(null)} />
      {dialog?.kind === 'edit' && (
        <EditUserDialog user={dialog.user} isSelf={dialog.user.id === me?.id} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'reset' && <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} />}
    </>
  )
}

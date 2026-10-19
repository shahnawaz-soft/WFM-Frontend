import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { listProjects, type ProjectFilters } from '../../api/projects'
import { PROJECT_ROLE_LABELS, PROJECT_STATUS_LABELS } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { CreateProjectDialog } from './CreateProjectDialog'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'active', label: 'In progress' },
  { value: 'finalized', label: 'Finalised' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

export function ProjectsPage() {
  const { can } = useAuth()
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<NonNullable<ProjectFilters['status']>>('current')
  const [offset, setOffset] = useState(0)
  const [creating, setCreating] = useState(false)
  const debouncedSearch = useDebouncedValue(search.trim())

  const filters: ProjectFilters = { search: debouncedSearch, status, limit: PAGE_SIZE, offset }
  const query = useQuery({
    queryKey: ['projects', filters],
    queryFn: () => listProjects(filters),
    placeholderData: keepPreviousData,
  })
  const filtered = Boolean(debouncedSearch) || status !== 'current'
  const total = query.data?.count ?? 0

  return (
    <>
      <div className="page-header">
        <h1>Projects</h1>
        {can('projects.create') && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            New project
          </Button>
        )}
      </div>

      <div className="filters" role="search" aria-label="Filter projects">
        <TextField
          label="Search"
          type="search"
          placeholder="Project name"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setOffset(0)
          }}
        />
        <SelectField
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status)
            setOffset(0)
          }}
        />
      </div>

      {query.isPending && <LoadingState label="Loading projects…" />}
      {query.error && !query.data && (
        <ErrorState title="Could not load projects" error={query.error} onRetry={() => void query.refetch()} />
      )}
      {query.data && query.data.results.length === 0 && (
        <EmptyState
          title={filtered ? 'No projects match these filters' : 'No projects yet'}
          action={
            !filtered && can('projects.create') ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create your first project
              </Button>
            ) : undefined
          }
        >
          {filtered
            ? 'Try a different search or status.'
            : 'Projects you create or are added to appear here.'}
        </EmptyState>
      )}

      {query.data && query.data.results.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="visually-hidden">Projects, {total} total</caption>
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Your role</th>
                  <th scope="col">Members</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {query.data.results.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <Link to={`/projects/${project.id}`} className="table__primary-link">
                        {project.name}
                      </Link>
                    </td>
                    <td>{project.my_role ? PROJECT_ROLE_LABELS[project.my_role] : <span className="muted">Not a member</span>}</td>
                    <td>{project.member_count}</td>
                    <td>
                      <StatusBadge
                        tone={project.status === 'archived' ? 'neutral' : project.status === 'finalized' ? 'info' : 'success'}
                        label={PROJECT_STATUS_LABELS[project.status]}
                      />
                    </td>
                    <td>{new Date(project.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > PAGE_SIZE && (
            <nav className="pagination" aria-label="Project pages">
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
          )}
        </>
      )}

      <CreateProjectDialog open={creating} onClose={() => setCreating(false)} />
    </>
  )
}

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { listProjects, type ProjectFilters } from '../../api/projects'
import { PROJECT_STATUS_LABELS } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { EmptyState, ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { Icon } from '../../components/ui/Icon'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { formatTonnes, formatTons } from '../abm/format'
import { Thumbnail } from '../drawings/Thumbnail'
import { CreateProjectDialog } from './CreateProjectDialog'

const PAGE_SIZE = 25
const STATUS_OPTIONS = [
  { value: 'current', label: 'Current' },
  { value: 'active', label: 'In progress' },
  { value: 'finalized', label: 'Finalised' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
]

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_557_600],
  ['month', 2_629_800],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
]

/** "5 minutes ago", "yesterday", "3 weeks ago". */
function timeAgo(iso: string, now = Date.now()) {
  const seconds = (new Date(iso).getTime() - now) / 1000
  const found = UNITS.find(([, size]) => Math.abs(seconds) >= size)
  return found ? RELATIVE.format(Math.round(seconds / found[1]), found[0]) : 'just now'
}

/** Client, team and people on the project, whichever are known. */
function projectMeta(project: { client_name: string; team_name: string; member_count: number }) {
  const parts = [project.client_name, project.team_name].filter(Boolean)
  if (project.member_count) parts.push(`${project.member_count} ${project.member_count === 1 ? 'member' : 'members'}`)
  return parts.join(' · ')
}

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
      <div className="page-header projects-header">
        <div>
          <h1>Projects</h1>
          <p className="projects-header__count muted">
            {query.data ? `${total} ${total === 1 ? 'project' : 'projects'}` : '\u00a0'}
          </p>
        </div>
        {can('projects.create') && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Icon name="plus" size={18} />
            New project
          </Button>
        )}
      </div>

      <div className="filters projects-filters" role="search" aria-label="Filter projects">
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
          <div className="table-wrap projects-table-wrap">
            <table className="table projects-table">
              <caption className="visually-hidden">Projects, {total} total</caption>
              <thead>
                <tr>
                  <th scope="col">Drawing</th>
                  <th scope="col">Project</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Tonnage
                  </th>
                  <th scope="col">Last updated</th>
                </tr>
              </thead>
              <tbody>
                {query.data.results.map((project) => (
                  <tr key={project.id}>
                    <td className="projects__thumb">
                      {project.cover_page ? (
                        <Link to={`/projects/${project.id}`} tabIndex={-1} aria-hidden="true">
                          <div role="img" aria-label={`Page 1 of ${project.name}`}>
                            <Thumbnail page={{ id: project.cover_page, thumbnail_status: 'ready' }} alt="" />
                          </div>
                        </Link>
                      ) : (
                        <span className="projects__thumb-empty muted">
                          <Icon name="drawing" size={22} />
                          No drawings
                        </span>
                      )}
                    </td>
                    <td className="projects__name">
                      <Link to={`/projects/${project.id}`} className="table__primary-link projects__link">
                        {project.name}
                      </Link>
                      {projectMeta(project) && <div className="projects__meta muted">{projectMeta(project)}</div>}
                    </td>
                    <td>
                      <StatusBadge
                        tone={project.status === 'archived' ? 'neutral' : project.status === 'finalized' ? 'info' : 'success'}
                        label={PROJECT_STATUS_LABELS[project.status]}
                      />
                    </td>
                    <td className="num">
                      {Number(project.tonnage.lb) > 0 ? (
                        <>
                          {formatTons(project.tonnage)}
                          <div className="muted">{formatTonnes(project.tonnage)}</div>
                        </>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="projects__updated">
                      <time dateTime={project.updated_at} title={new Date(project.updated_at).toLocaleString()}>
                        {timeAgo(project.updated_at)}
                      </time>
                      <div className="muted">
                        {new Date(project.updated_at).toLocaleDateString(undefined, {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </div>
                      <span className="projects__chevron" aria-hidden="true">
                        <Icon name="chevron" size={18} />
                      </span>
                    </td>
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

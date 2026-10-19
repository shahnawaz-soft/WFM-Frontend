import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router'

import { fetchReadiness } from '../api/health'
import { listProjects } from '../api/projects'
import { PROJECT_ROLE_LABELS } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { EmptyState, ErrorState, LoadingState } from '../components/feedback/States'
import { notify } from '../components/feedback/toastStore'
import { Button } from '../components/ui/Button'
import { StatusBadge } from '../components/ui/StatusBadge'

const CHECK_LABELS: Record<string, string> = {
  database: 'Database',
  storage: 'File storage',
  redis: 'Background job queue',
}

export function HomePage() {
  const { user } = useAuth()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Welcome, {user?.first_name || user?.email}
      </h1>
      <p className="lead">
        Steelo turns structural drawings into reviewable members, an approximate bill of
        materials (ABM) and a starting 3D wireframe. Features arrive phase by phase.
      </p>
      <RecentProjects />
      <SystemStatus />
    </>
  )
}

function RecentProjects() {
  const query = useQuery({
    queryKey: ['projects', { recent: true }],
    queryFn: () => listProjects({ status: 'active', limit: 5, offset: 0 }),
  })
  return (
    <section className="card" aria-labelledby="recent-projects-title">
      <div className="card__header">
        <h2 id="recent-projects-title">Recent projects</h2>
        <Link to="/projects">All projects</Link>
      </div>
      {query.isPending && <LoadingState label="Loading projects…" />}
      {query.error && <ErrorState title="Could not load projects" error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && query.data.results.length === 0 && (
        <EmptyState title="No projects yet">
          Create one from the <Link to="/projects">Projects</Link> page, or ask a colleague to add you.
        </EmptyState>
      )}
      {query.data && query.data.results.length > 0 && (
        <ul className="link-list">
          {query.data.results.map((project) => (
            <li key={project.id}>
              <Link to={`/projects/${project.id}`}>{project.name}</Link>
              <span className="muted">
                {project.my_role ? PROJECT_ROLE_LABELS[project.my_role] : 'Organisation access'} · updated{' '}
                {new Date(project.updated_at).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SystemStatus() {
  const { data, error, isPending, refetch, isFetching } = useQuery({
    queryKey: ['health', 'ready'],
    queryFn: fetchReadiness,
  })

  return (
    <section className="card" aria-labelledby="system-status-title">
      <div className="card__header">
        <h2 id="system-status-title">System status</h2>
        <Button
          onClick={async () => {
            const result = await refetch()
            if (result.data?.status === 'ok') notify.success('All systems are running')
          }}
          loading={isFetching && !isPending}
        >
          Check again
        </Button>
      </div>

      {isPending && <LoadingState label="Checking the Steelo server…" />}
      {error && (
        <ErrorState title="Server unreachable" error={error} onRetry={() => void refetch()} />
      )}
      {data && (
        <>
          <p>
            Overall:{' '}
            <StatusBadge
              tone={data.status === 'ok' ? 'success' : 'error'}
              label={data.status === 'ok' ? 'Operational' : 'Degraded'}
            />{' '}
            <span className="muted">Server version {data.version}</span>
          </p>
          <ul className="check-list" aria-label="Dependency checks">
            {Object.entries(data.checks ?? {}).map(([name, status]) => (
              <li key={name}>
                <span>{CHECK_LABELS[name] ?? name}</span>
                <StatusBadge
                  tone={status === 'ok' ? 'success' : 'error'}
                  label={status === 'ok' ? 'OK' : 'Unavailable'}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

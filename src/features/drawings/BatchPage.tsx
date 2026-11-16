import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'

import { getProject } from '../../api/projects'
import { toApiError } from '../../api/errors'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { BackLink } from '../../components/ui/BackLink'
import { projectCan } from '../projects/useProjectPermissions'
import { useBatchPages } from './batchPages'
import { BatchSection } from './Batches'
import { batchesQuery, drawingSetsQuery } from './queries'

/** One batch on its own page: its pages, who works on them, and (for whoever may) its actions. */
export function BatchPage() {
  const { projectId = '', batchId = '' } = useParams()
  const navigate = useNavigate()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const sets = useQuery(drawingSetsQuery(projectId))
  const batches = useQuery(batchesQuery(projectId))
  const batch = batches.data?.find((b) => b.id === batchId)
  const pages = useBatchPages(sets.data ?? [], batch, false, 'all')

  const error = project.error ?? sets.error ?? batches.error
  if (error) {
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not load the batch" error={error} />
    )
  }
  if (!project.data || !batches.data || !sets.data) return <LoadingState label="Loading batch…" />
  if (!batch) {
    return (
      <div className="state state--empty">
        <h1 className="state__title">Batch not found</h1>
        <p>It may have been deleted. Its pages are back on the project page.</p>
        <Link to={`/projects/${projectId}`}>Back to project</Link>
      </div>
    )
  }

  const canEdit = projectCan(project.data, 'project.edit')
  const isLead = projectCan(project.data, 'project.review')
  const assigned = batches.data.some((b) => b.assignees.length > 0)
  return (
    <>
      <BackLink to={`/projects/${projectId}`} label="Back to project" />
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/projects/${projectId}`}>{project.data.name}</Link> <span aria-hidden="true">/</span> {batch.name}
      </nav>
      <div className="page-header">
        <div>
          <h1>{batch.name}</h1>
          <p className="muted">
            {batch.progress.pages} {batch.progress.pages === 1 ? 'page' : 'pages'} · {batch.progress.processed} processed
            · {batch.progress.reviewed} reviewed · {batch.progress.added} added to the ABM
          </p>
        </div>
      </div>
      <section className="card" aria-label={`Batch ${batch.name}`}>
        <BatchSection
          projectId={projectId}
          batch={batch}
          pages={pages}
          canArrange={canEdit && (isLead || !assigned)}
          canAssign={isLead}
          kind="all"
          onDeleted={() => void navigate(`/projects/${projectId}`)}
        />
      </section>
    </>
  )
}

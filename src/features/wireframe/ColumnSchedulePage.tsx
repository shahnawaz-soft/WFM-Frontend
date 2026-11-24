import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { getProject } from '../../api/projects'
import { listWireframes } from '../../api/wireframe'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { BackLink } from '../../components/ui/BackLink'
import { projectCan } from '../projects/useProjectPermissions'
import { ColumnScheduler } from './ColumnScheduler'

/** The column scheduler on a page of its own (24 Nov 2026; as the old Wireframer's Column
 *  Schedule page): a wireframe revision's columns, ``?revision=`` or the latest generated. */
export function ColumnSchedulePage() {
  const { projectId = '' } = useParams()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const revisions = useQuery({ queryKey: ['wireframes', projectId], queryFn: () => listWireframes(projectId) })

  const error = project.error ?? revisions.error
  if (error) return <ErrorState title="Could not open the column schedule" error={error} />
  if (!project.data || !revisions.data) return <LoadingState label="Opening the column schedule…" />

  const generated = revisions.data.filter((w) => w.status === 'draft' || w.status === 'reviewed')
  const wanted = params.get('revision')
  const current = generated.find((w) => w.id === wanted) ?? generated[0]
  const back = `/projects/${projectId}/wireframe`
  const canEdit = projectCan(project.data, 'project.edit')

  return (
    <div className="col-page">
      <div className="col-page__crumbs">
        <BackLink to={back} label="Back to wireframe" />
        <nav aria-label="Breadcrumb" className="breadcrumb">
          <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
          <Link to={`/projects/${projectId}`}>{project.data.name}</Link> <span aria-hidden="true">/</span> <Link to={back}>Wireframe</Link>{' '}
          <span aria-hidden="true">/</span> <span>Column schedule</span>
        </nav>
      </div>
      {!current ? (
        <p className="muted">No wireframe has been generated yet: generate one on the wireframe page, then its columns are scheduled here.</p>
      ) : (
        <ColumnScheduler
          projectId={projectId}
          wireframeId={current.id}
          revisionNo={current.revision_no}
          datasetId={project.data.section_dataset?.id ?? null}
          editable={canEdit && current.status === 'draft' && current.is_latest}
          selectedId={selectedId}
          selection={selection}
          onSelectionChange={setSelection}
          onSelect={setSelectedId}
          onChanged={() => {
            void queryClient.invalidateQueries({ queryKey: ['wireframe', current.id, 'elements'] })
            void queryClient.invalidateQueries({ queryKey: ['wireframes', projectId] })
          }}
          grids={current.grids}
          canEditProject={canEdit}
          title={`Revision ${current.revision_no}${current.is_latest ? '' : ' (not the latest)'}`}
        />
      )}
    </div>
  )
}

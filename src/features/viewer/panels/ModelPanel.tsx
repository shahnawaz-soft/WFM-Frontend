import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { listWireframeElements, listWireframes } from '../../../api/wireframe'
import { LoadingState } from '../../../components/feedback/States'
import { IsometricPreview } from '../../wireframe/IsometricPreview'
import { supportsWebGL } from '../../wireframe/webgl'

const Wireframe3D = lazy(() => import('../../wireframe/Wireframe3D'))

interface ModelPanelProps {
  projectId: string
  /** The member chosen on this page: its element is highlighted. */
  memberId: string | null
  /** An element picked in the view: the member it was made from, if on this page. */
  onPickMember: (memberId: string) => void
}

/** The project's latest wireframe beside the page under review: the member chosen in the list or
 *  on the drawing is highlighted, and picking an element here chooses its member. The model is
 *  edited, and generated again, on the wireframe page. */
export function ModelPanel({ projectId, memberId, onPickMember }: ModelPanelProps) {
  const [webgl] = useState(supportsWebGL)
  const revisions = useQuery({ queryKey: ['wireframes', projectId], queryFn: () => listWireframes(projectId) })
  const latest = revisions.data?.[0]
  const generated = latest?.status === 'draft' || latest?.status === 'reviewed'
  const elements = useQuery({
    queryKey: ['wireframe', latest?.id, 'elements'],
    queryFn: () => listWireframeElements(latest!.id),
    enabled: Boolean(latest && generated),
  })
  const selected = useMemo(
    () => (memberId ? (elements.data?.find((e) => e.source_member === memberId) ?? null) : null),
    [elements.data, memberId],
  )
  const wireframeLink = `/projects/${projectId}/wireframe`
  const pick = (id: string | null) => {
    const member = elements.data?.find((e) => e.id === id)?.source_member
    if (member) onPickMember(member)
  }

  if (revisions.isPending) return <LoadingState label="Loading the model…" />
  if (!latest || !generated) {
    return (
      <div className="model-panel">
        <h2 className="panel__title">3D model</h2>
        <p className="muted">
          {latest?.status === 'generating'
            ? 'The wireframe is being generated.'
            : 'No wireframe yet. Set the levels, then generate it on the wireframe page.'}
        </p>
        <Link className="button" to={wireframeLink}>
          Go to the wireframe
        </Link>
      </div>
    )
  }
  return (
    <div className="model-panel">
      <h2 className="panel__title">3D model</h2>
      <p className="muted">
        Revision {latest.revision_no} · {latest.status === 'reviewed' ? 'reviewed' : 'draft'}
        {selected ? ` · ${selected.designation || selected.element_type} highlighted` : memberId ? ' · this member is not in the model' : ''}
      </p>
      {latest.changes_since && (
        <p className="notice notice--warning" role="note">
          Pages changed since it was generated: generate it again on the wireframe page to see them here.
        </p>
      )}
      <div className="model-panel__view">
        {elements.data ? (
          webgl ? (
            <Suspense fallback={<LoadingState label="Starting the 3D view…" />}>
              <Wireframe3D elements={elements.data} selectedId={selected?.id ?? null} view="3d" viewNonce={0} onSelect={pick} grids={latest.grids} />
            </Suspense>
          ) : (
            <IsometricPreview elements={elements.data} selectedId={selected?.id ?? null} onSelect={pick} />
          )
        ) : (
          <LoadingState label="Loading the model…" />
        )}
      </div>
      <Link to={memberId ? `${wireframeLink}?member=${memberId}` : wireframeLink}>Open the full 3D view</Link>
    </div>
  )
}

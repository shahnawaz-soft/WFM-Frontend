import { useState } from 'react'
import { Link } from 'react-router'

import type { Project } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { projectCan } from '../projects/useProjectPermissions'
import { FinalizeDialog } from './FinalizeDialog'
import { VersionDownloads } from './ProjectOutputsCard'
import { useOutputVersions } from './useOutputVersions'

/** Export from the ABM page. Files always come from a finalised version, so a downloaded
 *  ABM never changes under the person who sent it; until then this explains how to get one. */
export function AbmExport({ project }: { project: Project }) {
  const versions = useOutputVersions(project.id)
  const [dialog, setDialog] = useState<'export' | 'finalize' | null>(null)
  const current = versions.data?.find((v) => v.is_current)
  const latest = versions.data?.[0]
  const canFinalize = projectCan(project, 'project.finalize')

  if (project.status === 'finalized' && current) {
    return (
      <div className="abm__export" role="group" aria-label={`Export version ${current.version_no}`}>
        <span className="muted">Export version {current.version_no}</span>
        <VersionDownloads project={project} version={current} />
      </div>
    )
  }

  return (
    <>
      <Button onClick={() => setDialog('export')}>Export…</Button>
      {dialog === 'export' && (
        <Dialog open onOpenChange={(open) => !open && setDialog(null)} title="Export the ABM">
          <p>
            Exports (Excel, JSON and the IFC wireframe) are made from a <strong>finalised version</strong>, so the
            numbers in the file are frozen and match what was reviewed.
          </p>
          {canFinalize && project.status === 'active' ? (
            <p>Finalising checks the project first and lists anything still open.</p>
          ) : (
            <p className="muted">Ask the project owner to finalise the project.</p>
          )}
          {latest && (
            <div className="abm__export-previous">
              <p>
                Version {latest.version_no} was finalised before the project was reopened; its files are still
                available:
              </p>
              <VersionDownloads project={project} version={latest} />
            </div>
          )}
          <div className="button-row">
            <Link to={`/projects/${project.id}`}>Project page</Link>
            {canFinalize && project.status === 'active' && (
              <Button variant="primary" onClick={() => setDialog('finalize')}>
                Finalise…
              </Button>
            )}
          </div>
        </Dialog>
      )}
      {dialog === 'finalize' && <FinalizeDialog project={project} onClose={() => setDialog(null)} />}
    </>
  )
}

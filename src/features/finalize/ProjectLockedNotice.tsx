import { Link } from 'react-router'

import type { Project } from '../../api/types'
import { useOutputVersions } from './useOutputVersions'

/** Why pages can't be run or edited: a finalised project is read-only until it is reopened. */
export function ProjectLockedNotice({ project }: { project: Project }) {
  const versions = useOutputVersions(project.id)
  const current = versions.data?.find((v) => v.is_current)
  return (
    <p className="notice" role="status">
      This project is finalised{current ? ` (version ${current.version_no})` : ''}, so pages can't be run or edited.{' '}
      <Link to={`/projects/${project.id}`}>Reopen it on the project page</Link> to continue.
    </p>
  )
}

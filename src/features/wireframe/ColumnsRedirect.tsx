import { Navigate, useParams } from 'react-router'

/** The old column schedule page's address: there is one column scheduler, on the wireframe
 *  page. */
export function ColumnsRedirect() {
  const { projectId = '' } = useParams()
  return <Navigate to={`/projects/${projectId}/wireframe?tab=columns`} replace />
}

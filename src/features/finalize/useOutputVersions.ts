import { useQuery } from '@tanstack/react-query'

import { listOutputVersions } from '../../api/review'

/** The project's finalised versions, newest first. */
export const useOutputVersions = (projectId: string) =>
  useQuery({ queryKey: ['outputs', projectId], queryFn: () => listOutputVersions(projectId) })

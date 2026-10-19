import type { Project, ProjectCapability } from '../../api/types'

/** Capabilities come from the API per project; the UI only hides what the API would refuse. */
export function projectCan(project: Project | undefined, capability: ProjectCapability): boolean {
  return project?.my_capabilities.includes(capability) ?? false
}

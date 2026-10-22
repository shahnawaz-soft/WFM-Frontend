/** Friendly aliases over the generated OpenAPI types (src/api/schema.d.ts — do not edit). */
import type { components } from './schema'

type Schemas = components['schemas']

export type CurrentUser = Schemas['CurrentUser']
export type Session = Schemas['Session']
export type GlobalRole = Schemas['GlobalRoleEnum']
export type User = Schemas['User']
export type UserCreate = Schemas['UserCreateRequest']
export type UserUpdate = Schemas['PatchedUserUpdateRequest']
export type PaginatedUsers = Schemas['PaginatedUserList']

/** Mirrors backend steelo.accounts.capabilities.Capability (organisation-wide ones). */
export type Capability = 'projects.create' | 'users.manage' | 'ops.view'

export const GLOBAL_ROLE_LABELS: Record<GlobalRole, string> = {
  member: 'Member',
  operator: 'Operator',
  admin: 'Administrator',
}

export type Project = Schemas['Project']
export type PaginatedProjects = Schemas['PaginatedProjectList']
export type ProjectRole = Schemas['ProjectRoleEnum']
export type ProjectStatus = Schemas['ProjectStatusEnum']
export type Membership = Schemas['Membership']
export type UserLookup = Schemas['UserLookup']

/** Mirrors backend project-scoped capabilities (steelo.accounts.capabilities). */
export type ProjectCapability = 'project.view' | 'project.edit' | 'project.review' | 'project.finalize' | 'project.manage_members' | 'project.archive'

export const PROJECT_ROLES: {
  value: ProjectRole
  label: string
  description: string
}[] = [
  {
    value: 'owner',
    label: 'Owner',
    description: 'Everything, including members and archiving',
  },
  {
    value: 'reviewer',
    label: 'Reviewer',
    description: 'Edit, review and finalise outputs',
  },
  {
    value: 'editor',
    label: 'Editor',
    description: 'Upload, process and correct',
  },
  { value: 'viewer', label: 'Viewer', description: 'Read only' },
]

export const PROJECT_ROLE_LABELS = Object.fromEntries(PROJECT_ROLES.map((r) => [r.value, r.label])) as Record<ProjectRole, string>

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  active: 'Active',
  finalized: 'Finalised',
  archived: 'Archived',
}

export type DrawingSet = Schemas['DrawingSet']
export type DrawingPage = Schemas['DrawingPage']
export type ReviewReason = Schemas['ReviewReason']
export type PageStatus = Schemas['PageStatusEnum']
export type UploadLimits = Schemas['UploadLimits']

export type ProcessingJob = Schemas['ProcessingJob']
export type ExtractionRun = Schemas['ExtractionRun']
export type ColumnSymbol = Schemas['ColumnSymbol']
export type GridLine = Schemas['GridLine']
export type GridPoint = Schemas['GridPoint']
export type JobStatus = Schemas['JobStatusEnum']
export type PageKind = Schemas['PageKindEnum']

export type ExtractedMember = Schemas['ExtractedMember']
export type ExtractionIssue = Schemas['ExtractionIssue']

export type ReviewStatus = Schemas['ReviewStatusEnum']
export type MemberRevision = Schemas['MemberRevision']

export type MatchStatus = Schemas['MatchStatusEnum']
export type SectionDataset = Schemas['SectionDataset']
export type SectionProfile = Schemas['SectionProfile']

export type AbmEntry = Schemas['AbmEntry']
export type AbmSummary = Schemas['AbmSummary']
export type PaginatedAbmEntries = Schemas['PaginatedAbmEntryList']
/** How an entry's values were obtained (PRD §4.3: estimated, corrected or manual). */
export type AbmSource = 'detected' | 'corrected' | 'manual'
export type AbmTotals = Schemas['AbmTotals']
export type Weight = Schemas['Weight']

export type ProjectSummary = Schemas['ProjectSummary']
export type ProjectHistory = Schemas['ProjectHistory']
export type HistoryItem = Schemas['HistoryItem']
export type HistoryCategory = HistoryItem['category']

export type Wireframe = Schemas['Wireframe']
export type RevisionReport = Schemas['RevisionReport']
export type ConnectionLine = Schemas['ConnectionMaterialLine']
export type ConnectionList = Schemas['ConnectionMaterialList']
export type ConnectionKind = Schemas['ConnectionKindEnum']
export type ConnectionTemplate = Schemas['ConnectionTemplate']
export type ColumnSchedule = Schemas['Schedule']
export type LevelProposals = Schemas['LevelProposals']
export type LevelProposal = Schemas['LevelProposal']
export type ColumnCell = Schemas['Cell']
export type ColumnSyncResult = Schemas['SyncResult']
export type WireframeElement = Schemas['WireframeElement']
export type WireframeSetup = Schemas['WireframeSetup']

export type FinalizeCheck = Schemas['FinalizeCheck']
export type OutputVersion = Schemas['OutputVersion']

export type OpsJob = Schemas['OpsJob']
export type OpsJobPage = Schemas['OpsJobPage']
export type OpsAuditEvent = Schemas['OpsAuditEvent']
export type OpsAuditPage = Schemas['OpsAuditPage']

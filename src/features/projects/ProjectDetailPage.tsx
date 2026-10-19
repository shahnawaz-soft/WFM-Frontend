import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router'

import { getProject, renameProject, setArchived } from '../../api/projects'
import { toApiError } from '../../api/errors'
import { PROJECT_ROLE_LABELS, PROJECT_STATUS_LABELS, type Project } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { ProjectAbmCard } from '../abm/ProjectAbmCard'
import { ProjectOutputsCard } from '../finalize/ProjectOutputsCard'
import { ProjectReviewCard } from '../review-summary/ProjectReviewCard'
import { DrawingsSection } from '../drawings/DrawingsSection'
import { ProjectSectionData } from '../sections/ProjectSectionData'
import { MembersSection } from './MembersSection'
import { projectCan } from './useProjectPermissions'

export function ProjectDetailPage() {
  const { projectId = '' } = useParams()
  const query = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const heading = useRef<HTMLHeadingElement>(null)
  const loadedId = query.data?.id
  // Move focus to the page title once per project, so screen readers announce the page.
  useEffect(() => {
    if (loadedId) heading.current?.focus()
  }, [loadedId])

  if (query.isPending) return <LoadingState label="Loading project…" />
  if (query.error) {
    const notFound = toApiError(query.error).status === 404
    return notFound ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not load the project" error={query.error} onRetry={() => void query.refetch()} />
    )
  }

  const project = query.data
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span> <span>{project.name}</span>
      </nav>
      <div className="page-header">
        <div>
          <h1 ref={heading} tabIndex={-1}>
            {project.name}
          </h1>
          <p className="muted page-header__meta">
            <StatusBadge
              tone={project.status === 'archived' ? 'neutral' : project.status === 'finalized' ? 'info' : 'success'}
              label={PROJECT_STATUS_LABELS[project.status]}
            />{' '}
            Your role: {project.my_role ? PROJECT_ROLE_LABELS[project.my_role] : 'Not a member (organisation access)'} ·
            Created by {project.created_by.full_name} on {new Date(project.created_at).toLocaleDateString()}
          </p>
        </div>
        <ProjectActions project={project} />
      </div>

      {project.status === 'archived' && (
        <p className="notice" role="status">
          This project is archived and read-only
          {project.archived_at ? ` since ${new Date(project.archived_at).toLocaleDateString()}` : ''}.
          {projectCan(project, 'project.archive') ? ' Restore it to make changes.' : ''}
        </p>
      )}

      {project.status === 'finalized' && (
        <p className="notice" role="status">
          This project is finalised
          {project.finalized_at ? ` (${new Date(project.finalized_at).toLocaleDateString()})` : ''} and read-only. Download
          the finalised version below, or reopen the project to make changes.
        </p>
      )}

      <ProjectReviewCard project={project} />

      <ProjectOutputsCard project={project} />

      <DrawingsSection project={project} />

      <ProjectAbmCard project={project} />

      <ProjectSectionData project={project} />

      <MembersSection project={project} />
    </>
  )
}

function ProjectActions({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const archived = project.status === 'archived'

  const archive = useMutation({
    mutationFn: () => setArchived(project.id, !archived, project.version),
    meta: { successMessage: archived ? 'Project restored' : 'Project archived' },
    onSuccess: (updated) => {
      queryClient.setQueryData(['project', project.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      setConfirmArchive(false)
    },
  })

  return (
    <div className="button-row button-row--tight">
      {projectCan(project, 'project.edit') && <Button onClick={() => setRenaming(true)}>Rename</Button>}
      {projectCan(project, 'project.archive') &&
        (archived ? (
          <Button variant="primary" loading={archive.isPending} onClick={() => archive.mutate()}>
            Restore project
          </Button>
        ) : (
          <Button onClick={() => setConfirmArchive(true)}>Archive</Button>
        ))}

      {renaming && <RenameDialog project={project} onClose={() => setRenaming(false)} />}
      <ConfirmDialog
        open={confirmArchive}
        title={`Archive “${project.name}”?`}
        confirmLabel="Archive project"
        pending={archive.isPending}
        error={archive.error ? toApiError(archive.error).message : null}
        onConfirm={() => archive.mutate()}
        onCancel={() => setConfirmArchive(false)}
      >
        <p>
          The project becomes read-only for everyone and moves to the Archived list. Nothing is deleted, and an
          owner can restore it at any time.
        </p>
      </ConfirmDialog>
    </div>
  )
}

function RenameDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(project.name)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)

  const mutation = useMutation({
    mutationFn: () => renameProject(project.id, name.trim(), project.version),
    meta: { suppressErrorToast: true, successMessage: 'Project renamed' },
    onSuccess: (updated) => {
      queryClient.setQueryData(['project', project.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      onClose()
    },
    onError: (error) => {
      setErrors(toFormErrors(error))
      // Someone else changed the project: load their version so a retry is based on it.
      if (toApiError(error).code === 'stale_version') {
        void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      }
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setErrors({ fields: { name: ['Enter a project name.'] }, form: null })
    mutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Rename project">
      <FormAlert message={errors.form} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.fields.name}
          maxLength={200}
          autoFocus
        />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Save name
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

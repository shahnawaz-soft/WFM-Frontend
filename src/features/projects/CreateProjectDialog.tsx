import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'

import { createProject } from '../../api/projects'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { detailsPayload, NO_DETAILS } from './projectDetails'
import { ProjectDetailsFields } from './ProjectDetailsFields'

export function CreateProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [details, setDetails] = useState(NO_DETAILS)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)

  function close() {
    setName('')
    setDetails(NO_DETAILS)
    setErrors(NO_ERRORS)
    onClose()
  }

  const mutation = useMutation({
    mutationFn: () => createProject({ name: name.trim(), ...detailsPayload(details) }),
    meta: { suppressErrorToast: true, successMessage: 'Project created' },
    onSuccess: async (project) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      close()
      navigate(`/projects/${project.id}`)
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return setErrors({ fields: { name: ['Enter a project name.'] }, form: null })
    mutation.mutate()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && close()}
      title="New project"
      description="You become the project owner and can add colleagues afterwards."
    >
      <FormAlert message={errors.form} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.fields.name}
          maxLength={200}
          hint="For example the job name or tender reference."
          required
          autoFocus
        />
        <ProjectDetailsFields value={details} onChange={setDetails} errors={errors} />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Create project
          </Button>
          <Button onClick={close}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

import { TextField } from '../../components/ui/Field'
import type { FormErrors } from '../../lib/formErrors'
import type { ProjectDetails } from './projectDetails'

/** Client, team, Tekla version and target date, shared by the create and settings dialogs. */
export function ProjectDetailsFields({
  value,
  onChange,
  errors,
}: {
  value: ProjectDetails
  onChange: (value: ProjectDetails) => void
  errors: FormErrors
}) {
  const set = (field: keyof ProjectDetails) => (e: { target: { value: string } }) =>
    onChange({ ...value, [field]: e.target.value })
  return (
    <>
      <TextField label="Client name" value={value.client_name} onChange={set('client_name')} error={errors.fields.client_name} maxLength={200} />
      <TextField label="Team" value={value.team_name} onChange={set('team_name')} error={errors.fields.team_name} maxLength={120} />
      <TextField
        label="Tekla version"
        value={value.tekla_version}
        onChange={set('tekla_version')}
        error={errors.fields.tekla_version}
        maxLength={32}
        placeholder="e.g. 2024 SP3"
      />
      <TextField
        label="Target completion date"
        type="date"
        value={value.target_completion_date}
        onChange={set('target_completion_date')}
        error={errors.fields.target_completion_date}
      />
    </>
  )
}

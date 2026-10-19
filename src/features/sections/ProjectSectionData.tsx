import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { toApiError } from '../../api/errors'
import { listSectionDatasets, setProjectDataset } from '../../api/sections'
import type { Project } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { SelectField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { projectCan } from '../projects/useProjectPermissions'

/** Which section catalogue version gives this project's weights (OD-05), and changing it. */
export function ProjectSectionData({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const datasets = useQuery({ queryKey: ['section-datasets'], queryFn: listSectionDatasets, enabled: editing })
  const approved = (datasets.data ?? []).filter((d) => d.status === 'approved')
  const [choice, setChoice] = useState('')
  const canChange = projectCan(project, 'project.manage_members')
  const current = project.section_dataset

  const change = useMutation({
    mutationFn: () => setProjectDataset(project.id, choice),
    meta: { successMessage: 'Section data changed; members re-matched' },
    onSuccess: (updated) => {
      queryClient.setQueryData(['project', project.id], updated)
      void queryClient.invalidateQueries({ queryKey: ['drawing-page'] })
      setEditing(false)
    },
  })

  return (
    <section className="card" aria-labelledby="section-data-heading">
      <div className="card__header">
        <h2 id="section-data-heading">Section data</h2>
        {canChange && !editing && current && <Button onClick={() => setEditing(true)}>Change</Button>}
      </div>
      {current ? (
        <p>
          Weights use <strong>{current.label}</strong>.{' '}
          {current.is_test && <StatusBadge tone="warning" label="Test data — not for real estimates" />}
        </p>
      ) : (
        <p className="notice" role="status">
          No approved section data yet, so members have no weights. An administrator needs to import and approve the AISC
          Shapes Database.
        </p>
      )}
      {editing && (
        <div className="filters">
          <SelectField
            label="Use section data"
            value={choice || current?.id || ''}
            onChange={(e) => setChoice(e.target.value)}
            options={approved.map((d) => ({ value: d.id, label: d.label }))}
          />
          <div className="button-row button-row--tight">
            <Button variant="primary" loading={change.isPending} disabled={!choice || choice === current?.id} onClick={() => change.mutate()}>
              Use this version
            </Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </div>
          {change.error && <p className="field__error">{toApiError(change.error).message}</p>}
          <p className="muted">Every member in the project is matched again against the chosen version.</p>
        </div>
      )}
    </section>
  )
}

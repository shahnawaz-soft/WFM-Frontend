import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { createTemplate, deleteTemplate, editTemplate, listTemplates, type TemplateInput } from '../../api/connections'
import { toApiError } from '../../api/errors'
import type { ConnectionTemplate } from '../../api/types'
import { useAuth } from '../../auth/AuthContext'
import { notify } from '../../components/feedback/toastStore'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormAlert, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { LineFields } from './LineFields'
import { EMPTY_LINE, describeLine, lineErrors, toDraft, toInput, type LineDraft } from './lines'

/** The organisation's connection material templates: named sets of lines applied to ABM
 *  entries from the entry's Connection material panel. */
export function TemplatesPage() {
  const { can } = useAuth()
  const canKeep = can('projects.create')
  const templates = useQuery({ queryKey: ['connection-templates'], queryFn: listTemplates })
  const [creating, setCreating] = useState(false)

  if (templates.error) return <ErrorState title="Could not load the templates" error={templates.error} />
  if (!templates.data) return <LoadingState label="Loading templates…" />
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Connection templates</h1>
          <p className="muted">
            Standard sets of connection material (a shear tab, a moment connection, a base plate). Apply one to an ABM entry, every
            entry of its section on a page, or every one in the ABM, from the entry's Connection material panel. Applying copies the
            lines: changing a template later doesn't change lines already applied.
          </p>
        </div>
        {canKeep && !creating && (
          <Button variant="primary" onClick={() => setCreating(true)}>
            + New template
          </Button>
        )}
      </div>
      {creating && (
        <section className="card" aria-label="New template">
          <TemplateEditor onDone={() => setCreating(false)} />
        </section>
      )}
      {templates.data.length === 0 && !creating && (
        <p className="muted">No templates yet. Create one here, or save an entry's lines as a template from the ABM.</p>
      )}
      <div className="connection-templates">
        {templates.data.map((t) => (
          <TemplateCard key={t.id} template={t} canKeep={canKeep} />
        ))}
      </div>
    </>
  )
}

function TemplateCard({ template, canKeep }: { template: ConnectionTemplate; canKeep: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const remove = useMutation({
    mutationFn: () => deleteTemplate(template),
    meta: { suppressErrorToast: true, successMessage: `Template “${template.name}” deleted` },
    onSuccess: () => {
      setConfirm(false)
      void queryClient.invalidateQueries({ queryKey: ['connection-templates'] })
    },
  })
  return (
    <section className="card connection-template" aria-label={template.name}>
      {editing ? (
        <TemplateEditor template={template} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="card__header">
            <h2 className="connection-template__name">{template.name}</h2>
            {canKeep && (
              <div className="button-row button-row--tight">
                <Button onClick={() => setEditing(true)}>Edit</Button>
                <Button variant="danger" onClick={() => setConfirm(true)}>
                  Delete
                </Button>
              </div>
            )}
          </div>
          {template.note && <p className="muted">{template.note}</p>}
          <ul className="connection-template__lines" aria-label={`Lines in ${template.name}`}>
            {template.lines.map((l, i) => (
              <li key={i}>
                {describeLine(l)}
                {(l.grade || l.finish) && <span className="muted"> · {[l.grade, l.finish].filter(Boolean).join(', ')}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Delete “${template.name}”?`}
        confirmLabel="Delete template"
        pending={remove.isPending}
        error={remove.error ? toApiError(remove.error).message : null}
        onConfirm={() => remove.mutate()}
        onCancel={() => {
          setConfirm(false)
          remove.reset()
        }}
      >
        <p>Lines already applied from it stay on their entries.</p>
      </ConfirmDialog>
    </section>
  )
}

function TemplateEditor({ template, onDone }: { template?: ConnectionTemplate; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(template?.name ?? '')
  const [note, setNote] = useState(template?.note ?? '')
  const [lines, setLines] = useState<LineDraft[]>(template ? template.lines.map(toDraft) : [EMPTY_LINE])
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const save = useMutation({
    mutationFn: () => {
      const input: TemplateInput = { name, note, lines: lines.map(toInput) }
      return template ? editTemplate(template, input) : createTemplate(input)
    },
    meta: { suppressErrorToast: true },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['connection-templates'] })
      notify.success(`Template “${saved.name}” saved`)
      onDone()
    },
    onError: (e) => setErrors(toFormErrors(e)),
  })
  const linesMessage = Array.isArray(errors.fields.lines) && typeof errors.fields.lines[0] === 'string' ? errors.fields.lines : null
  return (
    <form
      className="connection-form"
      aria-label={template ? `Edit ${template.name}` : 'New template'}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <FormAlert message={errors.form ?? linesMessage?.join(' ')} />
      <div className="field-row">
        <TextField label="Template name" placeholder="Shear tab W12" value={name} onChange={(e) => setName(e.target.value)} error={errors.fields.name} />
        <TextField label="Note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} error={errors.fields.note} />
      </div>
      {lines.map((line, i) => (
        <fieldset className="connection-template__line" key={i}>
          <legend>Line {i + 1}</legend>
          <LineFields
            value={line}
            onChange={(next) => setLines((all) => all.map((l, j) => (j === i ? next : l)))}
            errors={lineErrors(errors.fields, i)}
          />
          {lines.length > 1 && (
            <button type="button" className="link-button" onClick={() => setLines((all) => all.filter((_, j) => j !== i))}>
              Remove line {i + 1}
            </button>
          )}
        </fieldset>
      ))}
      <div className="button-row button-row--tight">
        <Button onClick={() => setLines((all) => [...all, EMPTY_LINE])}>+ Add line</Button>
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save template
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

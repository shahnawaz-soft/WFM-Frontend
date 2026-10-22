import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import {
  addConnectionMaterial,
  createTemplate,
  editConnectionMaterial,
  listConnectionMaterial,
  listTemplates,
  removeConnectionMaterial,
  type ConnectionScope,
} from '../../api/connections'
import type { ConnectionLine, ExtractedMember } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { LineFields } from './LineFields'
import { EMPTY_LINE, describeLine, kindLabel, lineErrors, toDraft, toInput, type LineDraft } from './lines'

const REASONS: Record<string, string> = {
  member_length_missing: "needs the member's length",
  not_weighed: 'not weighed (no plate size or section data)',
  no_length: 'no length given',
}

type Mode = null | 'add' | 'template' | 'save' | { edit: ConnectionLine }

const linesKey = (projectId: string, memberId: string) => ['connection-material', projectId, memberId]

function useInvalidate(projectId: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['connection-material', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
  }
}

/** At the top of the entry's pane: how much connection material it has, and a jump to it
 *  (the panel sits below the editor, out of view in a short pane). */
export function ConnectionJump({ projectId, member }: { projectId: string; member: ExtractedMember }) {
  const lines = useQuery({ queryKey: linesKey(projectId, member.id), queryFn: () => listConnectionMaterial(projectId, member.id) })
  const count = lines.data?.lines.length
  return (
    <button
      type="button"
      className="connection-jump"
      onClick={() => document.getElementById(`cm-${member.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
    >
      Connection material{count != null ? ` (${count})` : ''} ↓
    </button>
  )
}

/** The connection material on an ABM entry: what each line works out to, adding, editing and
 *  removing lines, applying a template and saving the entry's lines as one. */
export function ConnectionPanel({ projectId, member, canEdit }: { projectId: string; member: ExtractedMember; canEdit: boolean }) {
  const lines = useQuery({ queryKey: linesKey(projectId, member.id), queryFn: () => listConnectionMaterial(projectId, member.id) })
  const [mode, setMode] = useState<Mode>(null)
  const invalidate = useInvalidate(projectId)
  const remove = useMutation({
    mutationFn: (line: ConnectionLine) => removeConnectionMaterial(line),
    meta: { successMessage: 'Line removed' },
    onSettled: invalidate,
  })

  const rows = lines.data?.lines ?? []
  const editing = mode && typeof mode === 'object' ? mode.edit.id : null
  return (
    <section className="connection-panel" aria-labelledby={`cm-${member.id}`}>
      <div className="connection-panel__header">
        <h3 id={`cm-${member.id}`}>Connection material</h3>
        {canEdit && mode === null && (
          <div className="connection-panel__actions">
            <Button onClick={() => setMode('add')}>+ Add</Button>
            <Button onClick={() => setMode('template')}>Apply template</Button>
          </div>
        )}
      </div>
      {lines.isPending && <p className="muted">Loading…</p>}
      {rows.length === 0 && !lines.isPending && <p className="muted">None on this entry.</p>}
      {rows.length > 0 && (
        <ul className="connection-panel__lines" aria-label={`Connection material on ${member.designation}`}>
          {rows.map((line) =>
            line.id === editing ? (
              <li key={line.id}>
                <LineForm projectId={projectId} member={member} line={line} onDone={() => setMode(null)} />
              </li>
            ) : (
              <li key={line.id} className="connection-line">
                <div className="connection-line__main">
                  <strong>{line.description}</strong> <span className="muted">{kindLabel(line.kind)}</span>
                  <div className="connection-line__worked">
                    {line.pieces != null ? `${line.pieces} pcs` : '—'}
                    {line.piece_length_display ? ` × ${line.piece_length_display}` : ''}
                    {line.total_length_display ? ` = ${line.total_length_display}` : ''}
                    {line.kind === 'spaced' && line.spacing_display ? ` · every ${line.spacing_display}` : ''}
                    {(line.grade || line.finish) && ` · ${[line.grade, line.finish].filter(Boolean).join(', ')}`}
                  </div>
                  {line.template_name && <div className="connection-line__from">from {line.template_name}</div>}
                  {line.reason && <div className="connection-line__reason">{REASONS[line.reason] ?? line.reason}</div>}
                </div>
                <span className="connection-line__weight">{line.weight ? `${Number(line.weight.lb).toLocaleString()} lb` : '—'}</span>
                {canEdit && mode === null && (
                  <span className="connection-line__actions">
                    <button type="button" className="link-button" aria-label={`Edit ${line.description}`} onClick={() => setMode({ edit: line })}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Remove ${line.description}`}
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(line)}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {canEdit && mode === null && rows.length > 0 && (
        <button type="button" className="link-button connection-panel__save" onClick={() => setMode('save')}>
          Save these lines as a template
        </button>
      )}
      {mode === 'add' && <LineForm projectId={projectId} member={member} onDone={() => setMode(null)} />}
      {mode === 'template' && <ApplyTemplateForm projectId={projectId} member={member} onDone={() => setMode(null)} />}
      {mode === 'save' && <SaveTemplateForm lines={rows} onDone={() => setMode(null)} />}
    </section>
  )
}

function ScopeField({ member, value, onChange }: { member: ExtractedMember; value: ConnectionScope; onChange: (s: ConnectionScope) => void }) {
  return (
    <SelectField
      label="Apply to"
      value={value}
      onChange={(e) => onChange(e.target.value as ConnectionScope)}
      options={[
        { value: 'entry', label: 'This entry' },
        { value: 'page', label: `Every ${member.designation} on this page` },
        { value: 'project', label: `Every ${member.designation} in the ABM` },
      ]}
    />
  )
}

function added(created: ConnectionLine[], what: string) {
  const entries = new Set(created.map((c) => c.member)).size
  notify.success(entries > 1 ? `${what} on ${entries} entries` : what)
}

/** A new line (with where it goes) or a change to ``line``. */
function LineForm({ projectId, member, line, onDone }: { projectId: string; member: ExtractedMember; line?: ConnectionLine; onDone: () => void }) {
  const invalidate = useInvalidate(projectId)
  const [draft, setDraft] = useState<LineDraft>(line ? toDraft(line) : EMPTY_LINE)
  const [scope, setScope] = useState<ConnectionScope>('entry')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const save = useMutation({
    mutationFn: async () =>
      line ? [await editConnectionMaterial(line, toInput(draft))] : addConnectionMaterial(projectId, [member.id], { lines: [toInput(draft)] }, scope),
    meta: { suppressErrorToast: true },
    onSuccess: (saved) => {
      invalidate()
      if (line) notify.success('Line saved')
      else added(saved, 'Line added')
      onDone()
    },
    onError: (error) => setErrors(toFormErrors(error)),
  })
  function submit(event: FormEvent) {
    event.preventDefault()
    save.mutate()
  }
  return (
    <form className="connection-form" onSubmit={submit} noValidate aria-label={line ? `Edit ${line.description}` : 'Add connection material'}>
      <FormAlert message={errors.form} />
      <LineFields value={draft} onChange={setDraft} errors={lineErrors(errors.fields, 0)} />
      {!line && <ScopeField member={member} value={scope} onChange={setScope} />}
      <div className="button-row button-row--tight">
        <Button type="submit" variant="primary" loading={save.isPending}>
          {line ? 'Save line' : 'Add'}
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function ApplyTemplateForm({ projectId, member, onDone }: { projectId: string; member: ExtractedMember; onDone: () => void }) {
  const invalidate = useInvalidate(projectId)
  const templates = useQuery({ queryKey: ['connection-templates'], queryFn: listTemplates })
  const [chosen, setChosen] = useState('')
  const [scope, setScope] = useState<ConnectionScope>('entry')
  const [error, setError] = useState<string | null>(null)
  const list = templates.data ?? []
  const template = list.find((t) => t.id === (chosen || list[0]?.id))
  const apply = useMutation({
    mutationFn: () => addConnectionMaterial(projectId, [member.id], { template: template!.id }, scope),
    meta: { suppressErrorToast: true },
    onSuccess: (created) => {
      invalidate()
      added(created, `${template!.name} applied`)
      onDone()
    },
    onError: (e) => setError(toFormErrors(e).form ?? 'Could not apply the template.'),
  })
  if (templates.isPending) return <p className="muted">Loading templates…</p>
  if (list.length === 0) {
    return (
      <div className="connection-form">
        <p className="muted">
          No templates yet. Add lines here and choose <em>Save these lines as a template</em>, or set them up under{' '}
          <Link to="/connection-templates">Connection templates</Link>.
        </p>
        <Button onClick={onDone}>Close</Button>
      </div>
    )
  }
  return (
    <form
      className="connection-form"
      aria-label="Apply a template"
      onSubmit={(e) => {
        e.preventDefault()
        apply.mutate()
      }}
    >
      <FormAlert message={error} />
      <SelectField
        label="Template"
        value={template?.id ?? ''}
        onChange={(e) => setChosen(e.target.value)}
        options={list.map((t) => ({ value: t.id, label: t.name }))}
      />
      {template && (
        <ul className="connection-template__lines" aria-label={`Lines in ${template.name}`}>
          {template.lines.map((l, i) => (
            <li key={i}>{describeLine(l)}</li>
          ))}
        </ul>
      )}
      <ScopeField member={member} value={scope} onChange={setScope} />
      <div className="button-row button-row--tight">
        <Button type="submit" variant="primary" loading={apply.isPending}>
          Apply
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

function SaveTemplateForm({ lines, onDone }: { lines: ConnectionLine[]; onDone: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const save = useMutation({
    mutationFn: () => createTemplate({ name, note, lines: lines.map((l) => toInput(toDraft(l))) }),
    meta: { suppressErrorToast: true },
    onSuccess: (template) => {
      void queryClient.invalidateQueries({ queryKey: ['connection-templates'] })
      notify.success(`Template “${template.name}” saved`)
      onDone()
    },
    onError: (e) => setErrors(toFormErrors(e)),
  })
  return (
    <form
      className="connection-form"
      aria-label="Save as a template"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <FormAlert message={errors.form} />
      <p className="muted">
        Saves the {lines.length} {lines.length === 1 ? 'line' : 'lines'} above, so you can apply them to other entries and projects.
      </p>
      <TextField label="Template name" placeholder="Shear tab W12" value={name} onChange={(e) => setName(e.target.value)} error={errors.fields.name} />
      <TextField label="Note" placeholder="Optional" value={note} onChange={(e) => setNote(e.target.value)} error={errors.fields.note} />
      <div className="button-row button-row--tight">
        <Button type="submit" variant="primary" loading={save.isPending}>
          Save template
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  )
}

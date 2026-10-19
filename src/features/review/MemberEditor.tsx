import { useMutation, useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { toApiError } from '../../api/errors'
import { editMember, memberHistory, restoreMember, reviewMember, type MemberChanges } from '../../api/members'
import type { ExtractedMember, ReviewStatus } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { isColumnMember, lengthNote, MATCH_LABELS } from '../viewer/memberAppearance'
import { formatKg, formatLb } from '../abm/format'
import { REVIEW_STATUS } from './reviewStatus'

interface MemberEditorProps {
  member: ExtractedMember
  index: number
  canEdit: boolean
  locked: boolean
  onSaved: (member: ExtractedMember) => void
  onStale: () => void
  onClose: () => void
  /** Shown after the section in the title (default "member N"). */
  subtitle?: string
}

const MEMBER_TYPES = [
  { value: '', label: 'Not set (beam)' },
  { value: 'beam', label: 'Beam' },
  { value: 'column', label: 'Column' },
  { value: 'brace', label: 'Brace' },
]

/** The type choices, keeping any other type already recorded (e.g. typed through the API). */
function typeOptions(current: string) {
  return MEMBER_TYPES.some((t) => t.value === current) ? MEMBER_TYPES : [...MEMBER_TYPES, { value: current, label: current }]
}

/** A column whose length (its storey height) is still to come from the page levels. */
const awaitingHeight = (member: ExtractedMember) => isColumnMember(member) && member.length_mm == null

/** How the current length was obtained, in words. */
function lengthHint(member: ExtractedMember): string | undefined {
  if (awaitingHeight(member)) {
    return "A column's length is its storey height: filled in from the page levels once this page has its level set (Level panel) and is added to the project. Type a length only to override it."
  }
  const mm = member.length_mm ? `${Number(member.length_mm).toLocaleString()} mm` : ''
  if (member.origin === 'manual' || member.is_corrected) return mm || 'No length entered'
  if (member.length_mm == null) return lengthNote(member) ?? 'Not measured by the extraction'
  const note = lengthNote(member)
  return `${mm} · measured centre-to-centre of supports${note ? ` · ${note.toLowerCase()}` : ''}`
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Added manually',
  edited: 'Corrected',
  reviewed: 'Review decision',
  restored: 'Restored original',
}

function describe(values: Record<string, unknown>): string {
  return Object.entries(values)
    .map(([k, v]) => `${k.replace('_mm', '').replace('_', ' ')}: ${v ?? '—'}`)
    .join(', ')
}

/** Correct one member and record a review decision. Original values are always shown. */
export function MemberEditor({ member, index, canEdit, locked, onSaved, onStale, onClose, subtitle }: MemberEditorProps) {
  const original = member.original as { designation?: string; length_mm?: number | null; quantity?: number }
  const [form, setForm] = useState({
    designation: member.designation,
    mark: member.mark,
    member_type: member.member_type,
    length: member.length_display,
    quantity: String(member.quantity),
    reason: '',
  })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const [showHistory, setShowHistory] = useState(false)
  const [statusNote, setStatusNote] = useState<string | null>(null)
  const editable = canEdit && !locked

  const handle = (error: unknown) => {
    setErrors(toFormErrors(error))
    if (toApiError(error).code === 'stale_version') onStale()
  }
  const done = (saved: ExtractedMember, message?: string) => {
    setErrors(NO_ERRORS)
    setForm((f) => ({ ...f, reason: '', length: saved.length_display, designation: saved.designation }))
    onSaved(saved)
    if (message) setStatusNote(message)
  }

  const save = useMutation({
    mutationFn: (changes: MemberChanges) => editMember(member.id, member.version, changes, form.reason),
    meta: { suppressErrorToast: true },
    onSuccess: (saved) => done(saved, 'Changes saved'),
    onError: handle,
  })
  const decide = useMutation({
    mutationFn: (status: ReviewStatus) => reviewMember(member.id, member.version, status, form.reason),
    meta: { suppressErrorToast: true },
    onSuccess: (saved) => done(saved, `Marked ${REVIEW_STATUS[saved.review_status].label.toLowerCase()}`),
    onError: handle,
  })
  const restore = useMutation({
    mutationFn: () => restoreMember(member.id, member.version),
    meta: { suppressErrorToast: true },
    onSuccess: (saved) => {
      setForm((f) => ({
        ...f,
        designation: saved.designation,
        mark: saved.mark,
        member_type: saved.member_type,
        length: saved.length_display,
        quantity: String(saved.quantity),
      }))
      done(saved, 'Original values restored')
    },
    onError: handle,
  })
  const history = useQuery({
    queryKey: ['member', member.id, 'history', member.version],
    queryFn: () => memberHistory(member.id),
    enabled: showHistory,
  })
  const busy = save.isPending || decide.isPending || restore.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    const quantity = Number(form.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) {
      return setErrors({ fields: { quantity: ['Enter a whole number of 1 or more.'] }, form: null })
    }
    const changes: MemberChanges = {}
    if (form.designation.trim().toUpperCase().replace(/\s+/g, '') !== member.designation) changes.designation = form.designation
    if (form.mark !== member.mark) changes.mark = form.mark
    if (form.member_type !== member.member_type) changes.member_type = form.member_type
    if (form.length.trim() !== member.length_display) changes.length = form.length
    if (quantity !== member.quantity) changes.quantity = quantity
    if (Object.keys(changes).length === 0) return setStatusNote('Nothing to save')
    save.mutate(changes)
  }

  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => {
    setStatusNote(null)
    setForm((f) => ({ ...f, [field]: e.target.value }))
  }
  const status = REVIEW_STATUS[member.review_status]

  return (
    <section className="member-editor" aria-labelledby="member-editor-title">
      <div className="member-editor__header">
        <h3 id="member-editor-title">
          {member.designation} <span className="muted">· {subtitle ?? `member ${index}`}</span>
        </h3>
        <Button onClick={onClose} aria-label="Close member details">
          ×
        </Button>
      </div>
      <p className="member-editor__meta">
        <StatusBadge tone={status.tone} label={status.label} />
        {member.is_corrected && <StatusBadge tone="info" label="Corrected" />}
        <span className="muted">
          {member.origin === 'manual'
            ? 'Added manually'
            : `Detected as ${original.designation ?? '—'}, ${Math.round(member.confidence * 100)}% confidence`}
        </span>
      </p>
      <p className="member-editor__section">
        {member.section ? (
          <>
            <strong>{member.section.designation}</strong> · {Number(member.section.weight_lb_per_ft)} lb/ft (
            {Number(member.section.weight_kg_per_m)} kg/m)
            <br />
            {member.weight ? (
              <>
                Weight: <strong>{formatLb(member.weight)}</strong> ({formatKg(member.weight)})
                {member.quantity > 1 && <span className="muted"> for {member.quantity}</span>}
              </>
            ) : awaitingHeight(member) ? (
              <span className="muted">Weight: once its height is known</span>
            ) : (
              <span className="muted">Weight: needs a length</span>
            )}
          </>
        ) : (
          <span className="field__error">{MATCH_LABELS[member.match_status]}</span>
        )}
      </p>
      {locked && <p className="notice notice--compact">This page’s review is complete. Reopen the review to change members.</p>}
      <FormAlert message={errors.form} />
      {statusNote && (
        <p className="member-editor__note" role="status">
          {statusNote}
        </p>
      )}

      <form onSubmit={submit} noValidate>
        <fieldset disabled={!editable || busy} className="member-editor__fields">
          <legend className="visually-hidden">Member values</legend>
          <TextField label="Section" value={form.designation} onChange={set('designation')} error={errors.fields.designation} autoCapitalize="characters" spellCheck={false} />
          <TextField label="Mark" value={form.mark} onChange={set('mark')} error={errors.fields.mark} placeholder="e.g. B12" />
          <SelectField
            label="Type"
            value={form.member_type}
            onChange={set('member_type')}
            error={errors.fields.member_type}
            options={typeOptions(member.member_type)}
          />
          <TextField label="Quantity" inputMode="numeric" value={form.quantity} onChange={set('quantity')} error={errors.fields.quantity} />
          <div className="member-editor__wide">
            <TextField
              label="Length"
              value={form.length}
              onChange={set('length')}
              error={errors.fields.length}
              placeholder={awaitingHeight(member) ? 'From levels' : 'e.g. 24\'-3" or 7391 mm'}
              hint={lengthHint(member)}
            />
          </div>
          <TextField
            label="Reason / note"
            value={form.reason}
            onChange={set('reason')}
            error={errors.fields.reason}
            hint="Required when rejecting. Saved in the history."
          />
        </fieldset>
        {editable && (
          <>
            <div className="button-row">
              <Button type="submit" variant="primary" loading={save.isPending}>
                Save changes
              </Button>
              {member.is_corrected && member.origin === 'automated' && (
                <Button onClick={() => restore.mutate()} disabled={busy}>
                  Restore original
                </Button>
              )}
            </div>
            <div className="button-row member-editor__decisions" role="group" aria-label="Review decision">
              <Button variant="primary" onClick={() => decide.mutate('accepted')} disabled={busy || member.review_status === 'accepted'}>
                Accept
              </Button>
              <Button variant="danger" onClick={() => decide.mutate('rejected')} disabled={busy || member.review_status === 'rejected'}>
                Reject
              </Button>
              <Button onClick={() => decide.mutate('needs_review')} disabled={busy || member.review_status === 'needs_review'}>
                Needs review
              </Button>
              <Button onClick={() => decide.mutate('unsupported')} disabled={busy || member.review_status === 'unsupported'}>
                Unsupported
              </Button>
            </div>
          </>
        )}
      </form>

      <button type="button" className="link-button" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)}>
        {showHistory ? 'Hide history' : 'Show history'}
      </button>
      {showHistory && (
        <ol className="history" aria-label="Member history">
          {history.isPending && <li className="muted">Loading…</li>}
          {history.data?.length === 0 && <li className="muted">No changes yet.</li>}
          {history.data?.map((rev) => (
            <li key={rev.id}>
              <strong>{ACTION_LABELS[rev.action] ?? rev.action}</strong> by {rev.actor} ·{' '}
              <time dateTime={rev.created_at}>{new Date(rev.created_at).toLocaleString()}</time>
              {Object.keys(rev.after).length > 0 && (
                <div className="muted">
                  {Object.keys(rev.before).length > 0 && <>{describe(rev.before)} → </>}
                  {describe(rev.after)}
                </div>
              )}
              {rev.reason && <div>“{rev.reason}”</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { toApiError } from '../../api/errors'
import { reviewMembers, type MemberChanges } from '../../api/members'
import type { ExtractedMember, ReviewStatus } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'
import { MEMBER_TYPES } from './memberTypes'

interface BulkReviewBarProps {
  pageId: string
  chosen: ExtractedMember[]
  onSaved: (members: ExtractedMember[]) => void
  /** Someone else changed one of them: the list is out of date. */
  onStale: () => void
  onClear: () => void
}

type Action = { status?: ReviewStatus; changes?: Omit<MemberChanges, 'mark'>; reason?: string }

const KEEP = '__keep__'

/** Accept, reject or edit the chosen members together (all of them, or none). */
export function BulkReviewBar({ pageId, chosen, onSaved, onStale, onClear }: BulkReviewBarProps) {
  const [dialog, setDialog] = useState<'reject' | 'edit' | null>(null)
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const count = chosen.length
  const noun = `${count} ${count === 1 ? 'member' : 'members'}`
  const save = useMutation({
    mutationFn: (action: Action) => reviewMembers(pageId, chosen, action),
    meta: { suppressErrorToast: true },
    onSuccess: (saved, action) => {
      onSaved(saved)
      notify.success(
        action.changes
          ? `${noun} changed${action.status ? ` and ${action.status}` : ''}`
          : `${action.status === 'accepted' ? 'Accepted' : 'Rejected'} ${noun}`,
      )
      setDialog(null)
      setErrors(NO_ERRORS)
      onClear()
    },
    onError: (error) => {
      if (toApiError(error).code === 'stale_version') onStale()
      setErrors(toFormErrors(error))
    },
  })
  const close = () => {
    setDialog(null)
    setErrors(NO_ERRORS)
  }

  return (
    <div className="bulk-bar" role="group" aria-label="Chosen members">
      <strong>{noun} chosen</strong>
      <div className="button-row button-row--tight">
        <Button loading={save.isPending && !dialog} onClick={() => save.mutate({ status: 'accepted' })}>
          Accept
        </Button>
        <Button onClick={() => setDialog('reject')}>Reject…</Button>
        <Button onClick={() => setDialog('edit')}>Edit…</Button>
        <Button onClick={onClear}>Clear</Button>
      </div>
      {!dialog && <FormAlert message={errors.form ?? errors.fields.members?.join(' ')} />}
      {dialog === 'reject' && (
        <RejectDialog noun={noun} pending={save.isPending} errors={errors} onReject={(reason) => save.mutate({ status: 'rejected', reason })} onClose={close} />
      )}
      {dialog === 'edit' && (
        <EditDialog noun={noun} chosen={chosen} pending={save.isPending} errors={errors} onSave={(action) => save.mutate(action)} onClose={close} />
      )}
    </div>
  )
}

function RejectDialog({
  noun,
  pending,
  errors,
  onReject,
  onClose,
}: {
  noun: string
  pending: boolean
  errors: FormErrors
  onReject: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    onReject(reason.trim())
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Reject ${noun}?`}>
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={errors.fields.reason}
          maxLength={500}
          hint="Kept on each member's history, e.g. duplicate tags or not steel."
          autoFocus
        />
        <div className="button-row">
          <Button type="submit" variant="danger" loading={pending}>
            Reject {noun}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** The value every chosen member has, or null where they differ (shown as "Mixed"). */
function shared<T>(chosen: ExtractedMember[], value: (m: ExtractedMember) => T): T | null {
  const first = chosen.length ? value(chosen[0]!) : null
  return chosen.every((m) => value(m) === first) ? first : null
}

function EditDialog({
  noun,
  chosen,
  pending,
  errors,
  onSave,
  onClose,
}: {
  noun: string
  chosen: ExtractedMember[]
  pending: boolean
  errors: FormErrors
  onSave: (action: Action) => void
  onClose: () => void
}) {
  // What the chosen members share, as detected: shown to start from; "Mixed" where they differ.
  const [start] = useState(() => {
    const quantity = shared(chosen, (m) => m.quantity)
    return {
      designation: shared(chosen, (m) => m.designation),
      member_type: shared(chosen, (m) => m.member_type),
      length: shared(chosen, (m) => m.length_display),
      quantity: quantity === null ? null : String(quantity),
      studs: shared(chosen, (m) => m.studs_text),
      camber: shared(chosen, (m) => m.camber_display),
    }
  })
  const [form, setForm] = useState({
    designation: start.designation ?? '',
    member_type: start.member_type ?? KEEP,
    length: start.length ?? '',
    quantity: start.quantity ?? '',
    studs: start.studs ?? '',
    camber: start.camber ?? '',
    reason: '',
    accept: false,
  })
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))
  // Only the fields changed, and filled in, change: the rest stay as each member has them.
  const edited = (field: 'designation' | 'length' | 'quantity' | 'studs' | 'camber') =>
    form[field].trim() !== '' && form[field].trim() !== (start[field] ?? '')
  const changes: Omit<MemberChanges, 'mark'> = {}
  if (edited('designation') && form.designation.trim().toUpperCase().replace(/\s+/g, '') !== start.designation)
    changes.designation = form.designation.trim()
  if (form.member_type !== KEEP && form.member_type !== start.member_type) changes.member_type = form.member_type
  if (edited('length')) changes.length = form.length.trim()
  if (edited('quantity')) changes.quantity = Number(form.quantity)
  if (edited('studs')) changes.studs = form.studs.trim()
  if (edited('camber')) changes.camber = form.camber.trim()
  const mixed = (value: string | null, example: string) => (value === null ? 'Mixed' : example)
  const nothing = Object.keys(changes).length === 0
  const fields = errors.fields as Record<string, string[] | undefined>
  // Errors of the changes come back nested ("changes": {"length": […]}).
  const nested = (errors.fields.changes as unknown as Record<string, string[]> | undefined) ?? {}
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ changes, reason: form.reason.trim(), ...(form.accept ? { status: 'accepted' as const } : {}) })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit ${noun}`} description="Shown as detected where they agree (Mixed where they differ). Change only what should change: every other value stays as each member has it.">
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField label="Section" placeholder={mixed(start.designation, 'e.g. W12X26')} value={form.designation} onChange={set('designation')} error={nested.designation ?? fields.designation} autoFocus />
        <SelectField
          label="Type"
          value={form.member_type}
          onChange={set('member_type')}
          error={nested.member_type}
          options={[{ value: KEEP, label: start.member_type === null ? 'Keep as it is (mixed)' : 'Keep as it is' }, ...MEMBER_TYPES]}
        />
        <TextField label="Length" placeholder={mixed(start.length, 'e.g. 24\'-3", 7391 mm')} value={form.length} onChange={set('length')} error={nested.length} />
        <TextField label="Quantity" type="number" min={1} max={9999} placeholder={mixed(start.quantity, '')} value={form.quantity} onChange={set('quantity')} error={nested.quantity} />
        <TextField label="Studs" placeholder={mixed(start.studs, 'e.g. 44 or 36, 4, 4')} value={form.studs} onChange={set('studs')} error={nested.studs} />
        <TextField label="Camber" placeholder={mixed(start.camber, 'e.g. 3/4" or 1 1/2"')} value={form.camber} onChange={set('camber')} error={nested.camber} hint="In inches" />
        <TextField label="Reason (optional)" value={form.reason} onChange={set('reason')} maxLength={500} />
        <label className="checkbox">
          <input type="checkbox" checked={form.accept} onChange={(e) => setForm((f) => ({ ...f, accept: e.target.checked }))} /> Also accept them
        </label>
        <div className="button-row">
          <Button type="submit" variant="primary" loading={pending} disabled={nothing}>
            Save {noun}
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

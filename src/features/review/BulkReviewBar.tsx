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
      {dialog === 'edit' && <EditDialog noun={noun} pending={save.isPending} errors={errors} onSave={(action) => save.mutate(action)} onClose={close} />}
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

function EditDialog({
  noun,
  pending,
  errors,
  onSave,
  onClose,
}: {
  noun: string
  pending: boolean
  errors: FormErrors
  onSave: (action: Action) => void
  onClose: () => void
}) {
  const [form, setForm] = useState({ designation: '', member_type: KEEP, length: '', quantity: '', studs: '', camber: '', reason: '', accept: false })
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }))
  // Only the fields filled in change: the rest stay as each member has them.
  const changes: Omit<MemberChanges, 'mark'> = {}
  if (form.designation.trim()) changes.designation = form.designation.trim()
  if (form.member_type !== KEEP) changes.member_type = form.member_type
  if (form.length.trim()) changes.length = form.length.trim()
  if (form.quantity.trim()) changes.quantity = Number(form.quantity)
  if (form.studs.trim()) changes.studs = form.studs.trim()
  if (form.camber.trim()) changes.camber = form.camber.trim()
  const nothing = Object.keys(changes).length === 0
  const fields = errors.fields as Record<string, string[] | undefined>
  // Errors of the changes come back nested ("changes": {"length": […]}).
  const nested = (errors.fields.changes as unknown as Record<string, string[]> | undefined) ?? {}
  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ changes, reason: form.reason.trim(), ...(form.accept ? { status: 'accepted' as const } : {}) })
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Edit ${noun}`} description="Fill in only what should change: every other value stays as each member has it.">
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField label="Section" placeholder="e.g. W12X26" value={form.designation} onChange={set('designation')} error={nested.designation ?? fields.designation} autoFocus />
        <SelectField
          label="Type"
          value={form.member_type}
          onChange={set('member_type')}
          error={nested.member_type}
          options={[{ value: KEEP, label: 'Keep as it is' }, ...MEMBER_TYPES]}
        />
        <TextField label="Length" placeholder={'e.g. 24\'-3", 7391 mm'} value={form.length} onChange={set('length')} error={nested.length} />
        <TextField label="Quantity" type="number" min={1} max={9999} value={form.quantity} onChange={set('quantity')} error={nested.quantity} />
        <TextField label="Studs" placeholder="e.g. 44 or 36, 4, 4" value={form.studs} onChange={set('studs')} error={nested.studs} />
        <TextField label="Camber" placeholder={'e.g. 3/4" or 1 1/2"'} value={form.camber} onChange={set('camber')} error={nested.camber} hint="In inches" />
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

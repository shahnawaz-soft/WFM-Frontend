import { useMutation } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { addManualMember } from '../../api/members'
import type { ExtractedMember } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { FormAlert, TextField } from '../../components/ui/Field'
import { NO_ERRORS, toFormErrors, type FormErrors } from '../../lib/formErrors'

interface AddMemberFormProps {
  pageId: string
  location: [number, number] | null
  onPickLocation: () => void
  onAdded: (member: ExtractedMember) => void
  onCancel: () => void
}

/** Add a member the extraction missed, optionally at a point picked on the drawing. */
export function AddMemberForm({ pageId, location, onPickLocation, onAdded, onCancel }: AddMemberFormProps) {
  const [form, setForm] = useState({ designation: '', mark: '', length: '', quantity: '1', reason: '' })
  const [errors, setErrors] = useState<FormErrors>(NO_ERRORS)
  const mutation = useMutation({
    mutationFn: () =>
      addManualMember(pageId, {
        designation: form.designation,
        mark: form.mark,
        length: form.length,
        quantity: Number(form.quantity),
        location,
        reason: form.reason,
      }),
    meta: { suppressErrorToast: true, successMessage: 'Member added' },
    onSuccess: onAdded,
    onError: (error) => setErrors(toFormErrors(error)),
  })
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [field]: e.target.value }))

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!form.designation.trim()) return setErrors({ fields: { designation: ['Enter the section, e.g. W12X26.'] }, form: null })
    const quantity = Number(form.quantity)
    if (!Number.isInteger(quantity) || quantity < 1) return setErrors({ fields: { quantity: ['Enter a whole number of 1 or more.'] }, form: null })
    mutation.mutate()
  }

  return (
    <section className="member-editor" aria-labelledby="add-member-title">
      <h3 id="add-member-title">Add a missed member</h3>
      <p className="muted">
        {location ? 'Location picked on the drawing. ' : 'No location on the drawing yet. '}
        <button type="button" className="link-button" onClick={onPickLocation}>
          {location ? 'Pick again' : 'Pick on the drawing'}
        </button>
      </p>
      <FormAlert message={errors.form} />
      <form onSubmit={submit} noValidate>
        <TextField label="Section" value={form.designation} onChange={set('designation')} error={errors.fields.designation} placeholder="e.g. W12X26" autoFocus />
        <TextField label="Mark" value={form.mark} onChange={set('mark')} error={errors.fields.mark} />
        <TextField label="Length" value={form.length} onChange={set('length')} error={errors.fields.length} placeholder={'e.g. 24\'-3" or 7391 mm'} />
        <TextField label="Quantity" inputMode="numeric" value={form.quantity} onChange={set('quantity')} error={errors.fields.quantity} />
        <TextField label="Reason / note" value={form.reason} onChange={set('reason')} hint="Optional. Saved in the history." />
        {errors.fields.location && <p className="field__error">{errors.fields.location.join(' ')}</p>}
        <div className="button-row">
          <Button type="submit" variant="primary" loading={mutation.isPending}>
            Add member
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </section>
  )
}

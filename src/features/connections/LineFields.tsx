import { useId } from 'react'

import type { ConnectionKind } from '../../api/types'
import { SelectField, TextField } from '../../components/ui/Field'
import { KINDS, SUGGESTIONS, type LineDraft, type LineErrors } from './lines'

/** The fields of one connection line; which show depends on its kind. */
export function LineFields({
  value,
  onChange,
  errors = {},
}: {
  value: LineDraft
  onChange: (next: LineDraft) => void
  errors?: LineErrors
}) {
  const set = (field: keyof LineDraft) => (e: { target: { value: string } }) => onChange({ ...value, [field]: e.target.value })
  const kind = KINDS.find((k) => k.value === value.kind)!
  const listId = useId()
  return (
    <>
      <SelectField
        label="Kind"
        value={value.kind}
        hint={kind.hint}
        onChange={(e) => onChange({ ...value, kind: e.target.value as ConnectionKind })}
        options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
      />
      <TextField
        label="Material"
        placeholder="e.g. PL1/2X8, L4X4X1/2"
        list={listId}
        value={value.description}
        onChange={set('description')}
        error={errors.description}
      />
      <datalist id={listId}>
        {SUGGESTIONS.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="field-row">
        {value.kind !== 'continuous' && (
          <TextField
            label={value.kind === 'stock' ? 'Stock length' : 'Length each'}
            placeholder={value.kind === 'stock' ? `20'-0"` : `1'-0"`}
            value={value.length}
            onChange={set('length')}
            error={errors.length}
          />
        )}
        {value.kind === 'spaced' && (
          <TextField label="Spacing" placeholder={`4'-0"`} value={value.spacing} onChange={set('spacing')} error={errors.spacing} />
        )}
        <TextField
          label={value.kind === 'manual' ? 'Pieces' : value.kind === 'spaced' ? 'Pieces at each place' : 'Runs'}
          type="number"
          min={1}
          value={value.quantity}
          onChange={set('quantity')}
          error={errors.quantity}
        />
      </div>
      <div className="field-row">
        <TextField label="Grade" placeholder="A36" value={value.grade} onChange={set('grade')} error={errors.grade} />
        <TextField label="Finish" placeholder="Prime" value={value.finish} onChange={set('finish')} error={errors.finish} />
      </div>
    </>
  )
}


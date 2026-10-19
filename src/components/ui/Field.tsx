import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

interface FieldShellProps {
  label: string
  hint?: ReactNode
  error?: string | string[]
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}

/** Label + control + hint + error, wired with aria-describedby / aria-invalid. */
function FieldShell({ label, hint, error, children }: FieldShellProps) {
  const inputId = useId()
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const messages = Array.isArray(error) ? error : error ? [error] : []
  const describedBy = [hint ? hintId : null, messages.length ? errorId : null]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="field">
      <label htmlFor={inputId} className="field__label">
        {label}
      </label>
      {children({ inputId, describedBy: describedBy || undefined, invalid: messages.length > 0 })}
      {hint && (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      )}
      {messages.length > 0 && (
        <p id={errorId} className="field__error">
          <span aria-hidden="true">! </span>
          {messages.join(' ')}
        </p>
      )}
    </div>
  )
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: string | string[]
}

export function TextField({ label, hint, error, ...input }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy, invalid }) => (
        <input
          id={inputId}
          className="field__control"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...input}
        />
      )}
    </FieldShell>
  )
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: string | string[]
  options: { value: string; label: string }[]
}

export function SelectField({ label, hint, error, options, ...select }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error}>
      {({ inputId, describedBy, invalid }) => (
        <select
          id={inputId}
          className="field__control"
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          {...select}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldShell>
  )
}

/** Form-level error summary (non-field errors, conflicts, network failures). */
export function FormAlert({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <div className="form-alert" role="alert">
      <span aria-hidden="true" className="form-alert__icon">
        !
      </span>
      {message}
    </div>
  )
}

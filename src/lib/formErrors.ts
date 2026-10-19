import { toApiError } from '../api/errors'

export interface FormErrors {
  fields: Record<string, string[]>
  form: string | null
}

export const NO_ERRORS: FormErrors = { fields: {}, form: null }

/** Split an API failure into per-field messages and one form-level message. */
export function toFormErrors(error: unknown): FormErrors {
  const apiError = toApiError(error)
  const { non_field_errors: nonField, ...fields } = apiError.fieldErrors
  if (apiError.code === 'validation_error') {
    return {
      fields,
      form: nonField?.join(' ') ?? (Object.keys(fields).length ? null : apiError.message),
    }
  }
  return { fields: {}, form: apiError.message }
}

import axios from 'axios'

/**
 * Normalised API error. Mirrors the backend envelope
 * `{"error": {"code", "message", "details", "request_id"}}` so UI code can switch on `code`.
 */
export class ApiError extends Error {
  readonly status: number | null
  readonly code: string
  readonly details: unknown
  readonly requestId: string | null

  constructor(opts: {
    status: number | null
    code: string
    message: string
    details?: unknown
    requestId?: string | null
  }) {
    super(opts.message)
    this.name = 'ApiError'
    this.status = opts.status
    this.code = opts.code
    this.details = opts.details ?? {}
    this.requestId = opts.requestId ?? null
  }

  /** Field-level validation messages, if the backend returned any. */
  get fieldErrors(): Record<string, string[]> {
    if (this.code !== 'validation_error' || typeof this.details !== 'object' || !this.details) {
      return {}
    }
    return this.details as Record<string, string[]>
  }
}

interface ErrorEnvelope {
  error: { code: string; message: string; details?: unknown; request_id?: string | null }
}

function isEnvelope(data: unknown): data is ErrorEnvelope {
  if (typeof data !== 'object' || data === null || !('error' in data)) return false
  const error = (data as { error: unknown }).error
  return typeof error === 'object' && error !== null && 'code' in error && 'message' in error
}

export const NETWORK_ERROR_MESSAGE =
  'Cannot reach the Steelo server. Check your connection and try again.'

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error

  if (axios.isAxiosError(error)) {
    const status = error.response?.status ?? null
    const headerId = error.response?.headers?.['x-request-id']
    const data: unknown = error.response?.data

    if (isEnvelope(data)) {
      return new ApiError({
        status,
        code: data.error.code,
        message: data.error.message,
        details: data.error.details,
        requestId: data.error.request_id ?? headerId ?? null,
      })
    }
    if (!error.response) {
      const timedOut = error.code === 'ECONNABORTED'
      return new ApiError({
        status: null,
        code: timedOut ? 'timeout' : 'network_error',
        message: timedOut ? 'The server took too long to respond. Please try again.' : NETWORK_ERROR_MESSAGE,
      })
    }
    return new ApiError({
      status,
      code: 'http_error',
      message: `The server returned an unexpected response (HTTP ${status}).`,
      requestId: typeof headerId === 'string' ? headerId : null,
    })
  }

  return new ApiError({
    status: null,
    code: 'client_error',
    message: error instanceof Error ? error.message : 'Something went wrong.',
  })
}

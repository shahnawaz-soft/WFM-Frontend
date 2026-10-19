import { AxiosError, AxiosHeaders } from 'axios'
import { describe, expect, it } from 'vitest'

import { ApiError, NETWORK_ERROR_MESSAGE, toApiError } from './errors'

function axiosErrorWith(status: number, data: unknown, headers: Record<string, string> = {}) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('fail', 'ERR_BAD_RESPONSE', config, null, {
    status,
    statusText: '',
    data,
    headers,
    config,
  })
}

describe('toApiError', () => {
  it('maps the backend error envelope', () => {
    const error = toApiError(
      axiosErrorWith(409, {
        error: {
          code: 'page_busy',
          message: 'Page is already processing.',
          details: { page_id: 'p1' },
          request_id: 'req-1',
        },
      }),
    )
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 409,
      code: 'page_busy',
      message: 'Page is already processing.',
      details: { page_id: 'p1' },
      requestId: 'req-1',
    })
  })

  it('exposes field errors for validation failures', () => {
    const error = toApiError(
      axiosErrorWith(400, {
        error: { code: 'validation_error', message: 'Invalid', details: { quantity: ['Too small'] } },
      }),
    )
    expect(error.fieldErrors).toEqual({ quantity: ['Too small'] })
  })

  it('handles non-envelope responses (e.g. proxy 502 HTML) with the request id header', () => {
    const error = toApiError(axiosErrorWith(502, '<html>Bad gateway</html>', { 'x-request-id': 'r2' }))
    expect(error).toMatchObject({ status: 502, code: 'http_error', requestId: 'r2' })
    expect(error.fieldErrors).toEqual({})
  })

  it('reports network failures without a status', () => {
    const error = toApiError(new AxiosError('Network Error', 'ERR_NETWORK'))
    expect(error).toMatchObject({ status: null, code: 'network_error', message: NETWORK_ERROR_MESSAGE })
  })

  it('reports timeouts distinctly', () => {
    expect(toApiError(new AxiosError('timeout', 'ECONNABORTED')).code).toBe('timeout')
  })

  it('wraps unknown errors and passes ApiError through', () => {
    expect(toApiError(new Error('boom'))).toMatchObject({ code: 'client_error', message: 'boom' })
    const original = new ApiError({ status: 404, code: 'not_found', message: 'x' })
    expect(toApiError(original)).toBe(original)
  })
})

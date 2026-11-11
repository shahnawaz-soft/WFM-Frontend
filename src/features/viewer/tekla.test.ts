import { afterEach, describe, expect, it, vi } from 'vitest'

import { pushToTekla, skippedSummary, TEKLA_INSERT_URL } from './tekla'

afterEach(() => vi.unstubAllGlobals())

describe('skippedSummary', () => {
  it('counts the reasons, most common first', () => {
    const level = 'The page has no level elevation.'
    const span = 'No measured span.'
    expect(
      skippedSummary([
        { id: '1', kind: 'beam', designation: 'W12X26', reasons: [level, span] },
        { id: '2', kind: 'beam', designation: 'W12X26', reasons: [level] },
      ]),
    ).toBe(`2 left out: ${level} (2) · ${span} (1)`)
    expect(skippedSummary([])).toBe('')
  })
})

describe('pushToTekla', () => {
  it('posts the payload to the macro and reads its counts', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ Success: true, Inserted: { Grids: 1, Beams: 47, Columns: 24 }, Errors: [] })),
    )
    vi.stubGlobal('fetch', fetchMock)
    const result = await pushToTekla({ replaceExisting: true, beams: [] })
    expect(fetchMock).toHaveBeenCalledWith(TEKLA_INSERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"replaceExisting":true,"beams":[]}',
    })
    expect(result).toEqual({ ok: true, grids: 1, beams: 47, columns: 24, errors: [] })
  })

  it('says when the macro is not running', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(pushToTekla({})).rejects.toThrow(/Start the HTTP server in the Tekla macro/)
  })

  it('passes on the errors Tekla reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ Success: false, Inserted: { Grids: 0, Beams: 3, Columns: 0 }, Errors: ['Beam bad'] })),
      ),
    )
    expect(await pushToTekla({})).toEqual({ ok: false, grids: 0, beams: 3, columns: 0, errors: ['Beam bad'] })
  })
})

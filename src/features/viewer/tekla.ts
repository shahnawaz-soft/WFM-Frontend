/** A plan page to Tekla (11 Nov 2026): the old Wireframer's beams and columns CSV, and "Push to
 *  Tekla", which sends the page straight to the Tekla macro's HTTP server on this PC. */

/** The macro's insert endpoint (its server bar: port 9876). */
export const TEKLA_INSERT_URL = 'http://localhost:9876/insert'

export interface TeklaSkipped {
  id: string
  kind: string
  designation: string
  reasons: string[]
}

export interface TeklaPushResult {
  ok: boolean
  grids: number
  beams: number
  columns: number
  errors: string[]
}

/** "2 left out: The page has no level elevation. (2) · …", the most common reasons first. */
export function skippedSummary(skipped: TeklaSkipped[]): string {
  if (!skipped.length) return ''
  const counts = new Map<string, number>()
  for (const s of skipped) for (const r of s.reasons) counts.set(r, (counts.get(r) ?? 0) + 1)
  const reasons = [...counts].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} (${n})`)
  return `${skipped.length} left out: ${reasons.join(' · ')}`
}

export function downloadText(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/** The macro answers in its own property names (Success, Inserted.Beams …). */
function field(o: Record<string, unknown> | undefined, name: string): unknown {
  return o?.[name] ?? o?.[name[0]!.toLowerCase() + name.slice(1)]
}

export async function pushToTekla(payload: unknown): Promise<TeklaPushResult> {
  let response: Response
  try {
    response = await fetch(TEKLA_INSERT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    throw new Error(
      'Could not reach Tekla on this PC (localhost:9876). Start the HTTP server in the Tekla macro, then push again. ' +
        'If Chrome asks to allow access to devices on your local network, allow it.',
    )
  }
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok && !('Inserted' in body || 'inserted' in body)) {
    throw new Error(`Tekla answered HTTP ${response.status}. ${String(field(body, 'Error') ?? '')}`.trim())
  }
  const inserted = field(body, 'Inserted') as Record<string, unknown> | undefined
  const errors = (field(body, 'Errors') as string[] | undefined) ?? []
  return {
    ok: Boolean(field(body, 'Success')) && errors.length === 0,
    grids: Number(field(inserted, 'Grids') ?? 0),
    beams: Number(field(inserted, 'Beams') ?? 0),
    columns: Number(field(inserted, 'Columns') ?? 0),
    errors,
  }
}

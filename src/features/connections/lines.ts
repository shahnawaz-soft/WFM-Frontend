import type { ConnectionLineInput } from '../../api/connections'
import type { ConnectionKind } from '../../api/types'

export const KINDS: { value: ConnectionKind; label: string; hint: string }[] = [
  { value: 'manual', label: 'Manual', hint: 'A number of pieces of a given length (plates, clips, bolts).' },
  { value: 'continuous', label: 'Continuous', hint: "Runs the member's full length (a ledger angle)." },
  { value: 'spaced', label: 'Spaced', hint: 'Pieces at a spacing along the member, ends included (stiffeners).' },
  { value: 'stock', label: 'Stock', hint: 'Runs the member, bought as whole stock-length bars.' },
]

export const kindLabel = (kind: ConnectionKind) => KINDS.find((k) => k.value === kind)?.label ?? kind

export const SUGGESTIONS = ['PL1/2X8', 'PL3/8X6', 'PL3/8X4', 'L4X4X1/2', 'L3X3X1/4', 'C10X15.3', '3/4" A325 BOLT', '7/8" A325 BOLT', 'HSS4X4X1/4']

/** One line as typed: lengths as text (feet-inches, inches or mm), parsed by the server. */
export interface LineDraft {
  kind: ConnectionKind
  description: string
  length: string
  spacing: string
  quantity: string
  grade: string
  finish: string
}

export const EMPTY_LINE: LineDraft = { kind: 'manual', description: '', length: '', spacing: '', quantity: '1', grade: '', finish: '' }

/** A stored line (a project line or a template's) back into the form. */
export function toDraft(line: {
  kind: ConnectionKind
  description: string
  length_display: string
  spacing_display: string
  quantity: number
  grade: string
  finish: string
}): LineDraft {
  return {
    kind: line.kind,
    description: line.description,
    length: line.kind === 'continuous' ? '' : line.length_display,
    spacing: line.kind === 'spaced' ? line.spacing_display : '',
    quantity: String(line.quantity),
    grade: line.grade,
    finish: line.finish,
  }
}

export function toInput(draft: LineDraft): ConnectionLineInput {
  return {
    kind: draft.kind,
    description: draft.description,
    length: draft.kind === 'continuous' ? '' : draft.length,
    spacing: draft.kind === 'spaced' ? draft.spacing : '',
    quantity: Number(draft.quantity) || 1,
    grade: draft.grade,
    finish: draft.finish,
  }
}

/** Errors for one line: the service reports them by field, the serializer under the line. */
export type LineErrors = Record<string, string[] | undefined>

export function lineErrors(fields: Record<string, unknown>, index: number): LineErrors {
  const nested = (fields.lines as LineErrors[] | undefined)?.[index]
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested
  return index === 0 ? (fields as LineErrors) : {}
}

/** "2 × PL1/2X8 × 1'-0"" for a template's line, before it is on a member. */
export function describeLine(line: { kind: ConnectionKind; description: string; length_display: string; spacing_display: string; quantity: number }) {
  const qty = line.quantity > 1 ? `${line.quantity} × ` : ''
  if (line.kind === 'continuous') return `${qty}${line.description}, full member length`
  if (line.kind === 'stock') return `${qty}${line.description} run, in ${line.length_display} bars`
  const length = line.length_display ? ` × ${line.length_display}` : ''
  const every = line.kind === 'spaced' ? ` every ${line.spacing_display}` : ''
  return `${qty}${line.description}${length}${every}`
}

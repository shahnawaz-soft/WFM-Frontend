import type { ExtractedMember } from '../../api/types'

/** How a member is drawn and described. Every kind has a distinct line style *and* a text
 *  label, so status never depends on colour alone (WCAG 1.4.1, PRD §5). */
export type MemberKind = 'detected' | 'low' | 'unsupported' | 'accepted' | 'rejected'

export const MEMBER_KINDS: Record<MemberKind, { label: string; dash: string }> = {
  detected: { label: 'Detected', dash: '' },
  low: { label: 'Low confidence', dash: '6 3' },
  unsupported: { label: 'Unsupported type', dash: '2 3' },
  accepted: { label: 'Accepted', dash: '' },
  rejected: { label: 'Rejected', dash: '1 4' },
}

export function memberKind(member: ExtractedMember): MemberKind {
  if (member.review_status === 'rejected') return 'rejected'
  if (member.review_status === 'accepted') return 'accepted'
  if (member.review_status === 'unsupported' || member.warnings.includes('unsupported_profile')) return 'unsupported'
  if (member.low_confidence) return 'low'
  return 'detected'
}

/** Plain-language names for member warnings (codes come from the extraction engine). */
export const WARNING_LABELS: Record<string, string> = {
  low_confidence: 'Low confidence',
  unsupported_profile: 'Unsupported type',
  length_not_determined: 'Length not measured',
  support_not_found: 'Support not found',
  length_implausible: 'Length implausible',
  length_long: 'Over 60 ft — check the length',
  member_line_ambiguous: 'Line ambiguous',
  scale_unconfirmed: 'Scale unconfirmed',
  column_by_leader: 'Column: height from levels',
  column_by_mark: 'Column: section from its mark in the column schedule',
  section_from_below: 'Column: section of the column below — check for a splice',
  text_recognised: 'Text read by recognition: check it',
  length_from_levels: 'Height from levels',
  size_not_shown: 'Size not given',
  not_on_plan: 'Not on a plan sheet',
  curved_member: 'Curved: length along the arc',
  same_column: 'Same column as on another page',
  overall_sheet: 'Overall plan: counted on its segment plans',
  label_shared: 'Label names several columns',
  from_column_schedule: 'Column: from the column schedule',
  locations_not_read: 'Column locations not read',
  in_column_schedule: 'Counted on the column schedule',
  post_label: 'Post: height not on the plan',
  reference_view: 'Reference view: not counted',
  beam_by_leader: 'Label tied to the beam by a leader',
  other_sheet: 'Past the match line: counted on the next sheet',
  typical_label: 'Column: named by a TYP label',
  brace_from_elevation: 'Brace: measured level to level on the elevation',
  counted_on_plans: 'On an elevation: counted on the plans',
  from_beam_legend: 'Beam: section from the beam legend, measured c/c',
  length_from_legend: 'Not measured: legend piece length, not c/c',
  measured_on_image: 'Measured c/c on the drawing image',
}

/** Warnings that explain how (or whether) a length was measured, most important first. */
const LENGTH_WARNINGS = ['same_column', 'in_column_schedule', 'from_column_schedule', 'length_from_legend', 'from_beam_legend', 'measured_on_image', 'length_from_levels', 'post_label', 'column_by_leader', 'column_by_mark', 'length_long', 'length_implausible', 'length_not_determined', 'support_not_found', 'member_line_ambiguous', 'scale_unconfirmed']

export function lengthNote(member: ExtractedMember): string | null {
  const code = LENGTH_WARNINGS.find((w) => member.warnings.includes(w))
  return code ? WARNING_LABELS[code]! : null
}

export const MATCH_LABELS: Record<string, string> = {
  matched: 'Matched',
  ambiguous: 'Ambiguous section',
  unmatched: 'Not in section data',
  unsupported: 'Unsupported type',
  no_section_data: 'No section data',
  not_in_tonnage: 'Not counted in tonnage',
}

/** Problems with the section match worth flagging on a row (matched = nothing to say). */
export function matchNote(member: ExtractedMember): string | null {
  if (member.match_status === 'matched' || member.match_status === 'unsupported') return null
  if (member.match_status === 'not_in_tonnage') return MATCH_LABELS.not_in_tonnage!
  return MATCH_LABELS[member.match_status] ?? null
}

export function weightPerFoot(member: ExtractedMember): string | null {
  return member.section ? `${Number(member.section.weight_lb_per_ft).toLocaleString()} lb/ft` : null
}

/** A column's length is its storey height, set from the page levels once the page is in the
 *  project (column schedule); until then it has none, and says so instead of "—". */
/** A column counted on another sheet (the same column on another plan of its storey, or on the
 * column schedule): no length here by design, and not in the ABM. Null otherwise. */
export function countedElsewhere(member: { warnings?: readonly string[] | null }): string | null {
  const warnings = member.warnings ?? []
  if (warnings.includes('same_column')) return 'Counted on another plan'
  if (warnings.includes('in_column_schedule')) return 'Counted on the column schedule'
  if (warnings.includes('overall_sheet')) return 'Counted on the segment plans'
  return null
}

export function isColumnMember(member: { member_type?: string | null }): boolean {
  return (member.member_type ?? '').trim().toLowerCase().startsWith('col')
}

/** A member's section as lists show it: its name, or "no label" when the drawing names none
 *  (a column found from its symbol, with no section written beside it). Its length is
 *  separate: from the plan, or for a column from the levels. */
export function sectionName(member: { designation: string; member_type?: string | null }): string {
  if (member.designation) return member.designation
  return member.member_type === 'column' ? 'Column, no label' : 'No label'
}

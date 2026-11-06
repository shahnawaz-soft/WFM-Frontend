import type { DrawingPageListItem } from '../../api/types'

/** The kind of sheet, as the engine classified it (plan, section, detail …). */
export const SHEET_KIND_LABELS: Record<string, string> = {
  plan: 'Plan',
  elevation: 'Elevation',
  section: 'Section',
  detail: 'Detail',
  schedule: 'Schedule',
  notes: 'Notes',
  reference: 'Reference',
}

/** The filter groups of the Pages block, in this order. */
export const KIND_GROUPS = [
  { key: 'plan', label: 'Plans' },
  { key: 'elevation', label: 'Elevations' },
  { key: 'section', label: 'Sections' },
  { key: 'detail', label: 'Details' },
  { key: 'schedule', label: 'Schedules' },
  { key: 'notes', label: 'Notes' },
  { key: 'other', label: 'Other' },
  { key: 'unread', label: 'Not run yet' },
] as const

export type KindGroup = (typeof KIND_GROUPS)[number]['key'] | 'all'

/** The tabs a person can move a page to (every group but "Not run yet"). */
export const MOVABLE_GROUPS = KIND_GROUPS.filter((g) => g.key !== 'unread')

/** The tab a page is listed under: where a person moved it, else by the kind read from it. */
export function kindGroup(page: DrawingPageListItem): Exclude<KindGroup, 'all'> {
  if (page.sheet_kind) return page.sheet_kind as Exclude<KindGroup, 'all'>
  return readGroup(page)
}

/** The tab of the kind Steelo read from the page (where "As read" puts it back). */
export function readGroup(page: DrawingPageListItem): Exclude<KindGroup, 'all'> {
  const kind = page.current_run?.sheet_kind
  if (!page.current_run) return 'unread'
  return kind && kind in SHEET_KIND_LABELS && kind !== 'reference' ? (kind as Exclude<KindGroup, 'all'>) : 'other'
}

/** A tab named in the address (``?tab=plan``); 'all' for none or one that doesn't exist. */
export function tabFromParam(value: string | null): KindGroup {
  return KIND_GROUPS.some((g) => g.key === value) ? (value as KindGroup) : 'all'
}

export function groupLabel(key: KindGroup): string {
  return key === 'all' ? 'All' : (KIND_GROUPS.find((g) => g.key === key)?.label ?? key)
}

/** Numbers read on more than one page of a file are a job or project code, not sheet numbers. */
export function repeatedNumbers(pages: DrawingPageListItem[]): Set<string> {
  const seen = new Map<string, number>()
  for (const p of pages) {
    const n = p.current_run?.sheet_number
    if (n) seen.set(n, (seen.get(n) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([n]) => n))
}

/** "S302 · THIRD FLOOR FRAMING PLAN": a person's name for the sheet, else the one read. */
export function sheetLabel(page: DrawingPageListItem, repeated: Set<string>): string {
  if (page.sheet_name) return page.sheet_name
  const number = page.current_run?.sheet_number
  return [number && !repeated.has(number) ? number : '', page.current_run?.sheet_title ?? ''].filter(Boolean).join(' · ')
}

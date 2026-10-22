import type { AbmFilters } from '../../api/abm'
import type { AbmSource } from '../../api/types'

/** ABM filter state as kept in the address bar, so a filtered view can be shared or bookmarked. */
export interface FilterState {
  search: string
  profile: string
  designation: string
  page: string
  status: string
  source: string
  match: string
  confidence: string
  length_min: string
  length_max: string
  length_missing: boolean
  to_check: boolean
  quantity_min: string
  quantity_max: string
  ordering: string
  offset: number
}

export const PAGE_SIZE = 100

export const EMPTY: FilterState = {
  search: '',
  profile: '',
  designation: '',
  page: '',
  status: '',
  source: '',
  match: '',
  confidence: '',
  length_min: '',
  length_max: '',
  length_missing: false,
  to_check: false,
  quantity_min: '',
  quantity_max: '',
  ordering: 'page',
  offset: 0,
}

/** Review-state choices; "open" groups the two states that still need a person. */
export const STATUS_OPTIONS = [
  { value: '', label: 'All entries' },
  { value: 'open', label: 'Awaiting review' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'unsupported', label: 'Unsupported' },
  { value: 'rejected', label: 'Removed (rejected)' },
]

export const SOURCE_LABELS: Record<AbmSource, string> = {
  detected: 'Estimated',
  corrected: 'Corrected',
  manual: 'Manual',
}

export const SOURCE_OPTIONS = [
  { value: '', label: 'All values' },
  { value: 'detected', label: 'Estimated (as detected)' },
  { value: 'corrected', label: 'Corrected' },
  { value: 'manual', label: 'Added manually' },
]

export const MATCH_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'matched', label: 'Matched' },
  { value: 'unmatched,ambiguous,no_section_data', label: 'Not matched' },
  { value: 'unsupported', label: 'Unsupported type' },
  { value: 'not_in_tonnage', label: 'Not in tonnage (joists)' },
]

export const CONFIDENCE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: '0.7', label: 'Below 70%' },
  { value: '0.5', label: 'Below 50%' },
]

const TEXT_KEYS = ['search', 'profile', 'designation', 'page', 'status', 'source', 'match', 'confidence', 'length_min', 'length_max', 'quantity_min', 'quantity_max', 'ordering'] as const

export function fromSearch(params: URLSearchParams): FilterState {
  const state: FilterState = { ...EMPTY }
  for (const key of TEXT_KEYS) state[key] = params.get(key) ?? EMPTY[key]
  state.length_missing = params.get('length_missing') === 'true'
  state.to_check = params.get('to_check') === 'true'
  state.offset = Math.max(0, Number(params.get('offset')) || 0)
  return state
}

/** Writes the filters into ``params`` (other keys, such as the selected member, are kept). */
export function toSearch(state: FilterState, params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of TEXT_KEYS) {
    if (state[key] && state[key] !== EMPTY[key]) next.set(key, state[key])
    else next.delete(key)
  }
  if (state.length_missing) next.set('length_missing', 'true')
  else next.delete('length_missing')
  if (state.to_check) next.set('to_check', 'true')
  else next.delete('to_check')
  if (state.offset) next.set('offset', String(state.offset))
  else next.delete('offset')
  return next
}

export function toApi(state: FilterState): AbmFilters {
  const status =
    state.status === 'open'
      ? { review_status: 'unreviewed,needs_review' }
      : state.status === 'rejected'
        ? { review_status: 'rejected', include_rejected: true }
        : { review_status: state.status }
  return {
    search: state.search.trim(),
    profile: state.profile,
    designation: state.designation,
    page: state.page,
    ...status,
    source: state.source,
    match_status: state.match,
    confidence_lt: state.confidence,
    length_min: state.length_min.trim(),
    length_max: state.length_max.trim(),
    length_missing: state.length_missing,
    to_check: state.to_check,
    quantity_min: state.quantity_min,
    quantity_max: state.quantity_max,
    ordering: state.ordering,
    limit: PAGE_SIZE,
    offset: state.offset,
  }
}

/** Number of filters in use (not counting sort order and paging). */
export function activeCount(state: FilterState): number {
  return (
    TEXT_KEYS.filter((k) => k !== 'ordering' && state[k] !== EMPTY[k]).length +
    (state.length_missing ? 1 : 0) +
    (state.to_check ? 1 : 0)
  )
}

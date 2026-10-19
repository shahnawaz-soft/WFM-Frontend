import { useEffect, useRef } from 'react'

import type { AbmEntry, AbmSource } from '../../api/types'
import { REVIEW_STATUS } from '../review/reviewStatus'
import { isColumnMember, lengthNote, matchNote, MEMBER_KINDS, memberKind, weightPerFoot } from '../viewer/memberAppearance'
import { SOURCE_LABELS } from './filters'
import { lbValue } from './format'

interface AbmTableProps {
  entries: AbmEntry[]
  /** Number of the first row (paging). */
  firstNumber: number
  selectedId: string | null
  hoveredId: string | null
  ordering: string
  onSort: (ordering: string) => void
  onSelect: (entry: AbmEntry) => void
  onHover: (id: string | null) => void
}

const SORTABLE: { key: string; label: string; numeric?: boolean }[] = [
  { key: 'designation', label: 'Section' },
  { key: 'mark', label: 'Mark' },
  { key: 'length', label: 'Length' },
  { key: 'quantity', label: 'Qty', numeric: true },
]

function flags(entry: AbmEntry): string {
  const out: string[] = []
  const kind = memberKind(entry)
  if (entry.warnings.includes('unsupported_profile')) out.push(MEMBER_KINDS.unsupported.label)
  const match = matchNote(entry)
  if (match) out.push(match)
  if (entry.origin !== 'manual' && !entry.is_corrected) {
    const note = lengthNote(entry)
    if (note) out.push(note)
    if (entry.low_confidence && kind !== 'accepted') out.push(MEMBER_KINDS.low.label)
  } else if (entry.length_mm == null) {
    out.push('No length')
  }
  return out.join(' · ')
}

/** ABM rows. Selecting a row shows the member on its drawing (and the drawing selects rows). */
export function AbmTable({ entries, firstNumber, selectedId, hoveredId, ordering, onSort, onSelect, onHover }: AbmTableProps) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  // Selected on the drawing → bring its row into view.
  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const header = (key: string, label: string, numeric = false) => {
    const active = ordering.replace('-', '') === key
    const descending = ordering.startsWith('-')
    return (
      <th
        key={key}
        scope="col"
        className={numeric ? 'num' : undefined}
        aria-sort={active ? (descending ? 'descending' : 'ascending') : undefined}
      >
        <button type="button" className="sort-button" onClick={() => onSort(active && !descending ? `-${key}` : key)}>
          {label}
          <span aria-hidden="true">{active ? (descending ? ' ▼' : ' ▲') : ''}</span>
        </button>
      </th>
    )
  }

  return (
    <table className="table table--compact quantities abm-table">
      <caption className="visually-hidden">
        ABM. Select an entry to show it on its drawing. Column headers sort the list.
      </caption>
      <thead>
        <tr>
          <th scope="col" className="num">
            #
          </th>
          {SORTABLE.map((c) => header(c.key, c.label, c.numeric))}
          <th scope="col" className="num">
            Studs
          </th>
          <th scope="col" className="num">
            Camber
          </th>
          <th scope="col" className="num">
            Wt/ft
          </th>
          {header('weight', 'Weight (lb)', true)}
          {header('page', 'Page')}
          {header('status', 'Status')}
          <th scope="col">Values</th>
          {header('confidence', 'Conf.', true)}
          <th scope="col">Flags</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry, i) => {
          const selected = entry.id === selectedId
          const number = firstNumber + i
          return (
            <tr
              key={entry.id}
              ref={(el) => {
                if (el) rowRefs.current.set(entry.id, el)
                else rowRefs.current.delete(entry.id)
              }}
              data-selected={selected || undefined}
              data-hovered={entry.id === hoveredId || undefined}
              onPointerEnter={() => onHover(entry.id)}
              onPointerLeave={() => onHover(null)}
              // Anywhere on the row selects it; the section button is the keyboard way in.
              onClick={(event) => {
                if (!(event.target as HTMLElement).closest('button, a, input, select')) onSelect(entry)
              }}
            >
              <td className="num muted">{number}</td>
              <td>
                <button
                  type="button"
                  className="link-button"
                  aria-pressed={selected}
                  aria-label={`${entry.designation}, entry ${number}, page ${entry.page_number}. Show on drawing`}
                  onClick={() => onSelect(entry)}
                >
                  {entry.designation}
                </button>
              </td>
              <td className="nowrap">
                {entry.mark ? (
                  entry.mark
                ) : entry.piece_mark ? (
                  <span className="piece-mark" title="Preliminary mark from Steelo: identical members share one. Type a mark to replace it.">
                    {entry.piece_mark}
                    <span className="visually-hidden"> (preliminary, from Steelo)</span>
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td className="nowrap">
                {entry.length_mm != null ? (
                  entry.length_display
                ) : isColumnMember(entry) ? (
                  <span className="muted" title="A column's length is its storey height, from the page levels">
                    From levels
                  </span>
                ) : (
                  <>
                    <span aria-hidden="true" className="muted">
                      —
                    </span>
                    <span className="visually-hidden">No length</span>
                  </>
                )}
              </td>
              <td className="num">{entry.quantity}</td>
              <td className="num nowrap" title={entry.studs == null && entry.studs_text ? 'Studs by segment, as printed' : undefined}>
                {entry.studs_text || <span className="muted">—</span>}
              </td>
              <td className="num nowrap">{entry.camber_display || <span className="muted">—</span>}</td>
              <td className="num nowrap">
                {weightPerFoot(entry)?.replace(' lb/ft', '') ?? <span className="muted" aria-label="No weight">—</span>}
              </td>
              <td className="num nowrap">
                {lbValue(entry.weight) ?? <span className="muted" aria-label="Not weighed">—</span>}
              </td>
              <td className="nowrap" title={entry.drawing_set.original_filename}>
                p.{entry.page_number} <span className="muted abm-table__file">{entry.drawing_set.original_filename}</span>
              </td>
              <td className="nowrap">{REVIEW_STATUS[entry.review_status].label}</td>
              <td className="nowrap">{SOURCE_LABELS[entry.source as AbmSource] ?? entry.source}</td>
              <td className="num">{Math.round(entry.confidence * 100)}%</td>
              <td className="abm-table__flags">{flags(entry)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

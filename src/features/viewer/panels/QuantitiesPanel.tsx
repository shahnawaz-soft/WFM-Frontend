import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ExtractedMember } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { REVIEW_STATUS } from '../../review/reviewStatus'
import { countedElsewhere, isColumnMember, lengthNote, matchNote, memberKind, MEMBER_KINDS, weightPerFoot } from '../memberAppearance'

interface QuantitiesPanelProps {
  members: ExtractedMember[]
  loading: boolean
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  /** Review progress/actions and the selected member's editor, shown above the list. */
  children?: ReactNode
  onAdd?: () => void
}

interface Group {
  designation: string
  count: number
}

/** Short flags for a row: section type problems first, then how the length was obtained. */
function memberFlags(member: ExtractedMember, kind: ReturnType<typeof memberKind>): string {
  const flags: string[] = []
  if (kind === 'unsupported') flags.push(MEMBER_KINDS.unsupported.label)
  const match = matchNote(member)
  if (match) flags.push(match)
  const note = lengthNote(member)
  if (note) flags.push(note)
  if (!flags.length && kind === 'low') flags.push(MEMBER_KINDS.low.label)
  return flags.join(' · ')
}

/** Every detected member on the page, linked both ways with the drawing. */
export function QuantitiesPanel({ members, loading, selectedId, hoveredId, onSelect, onHover, children, onAdd }: QuantitiesPanelProps) {
  const [search, setSearch] = useState('')
  const [grouped, setGrouped] = useState(false)
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const query = search.trim().toUpperCase().replace(/\s+/g, '')
  const visible = useMemo(() => (query ? members.filter((m) => m.designation.includes(query)) : members), [members, query])
  const groups = useMemo(() => {
    const map = new Map<string, Group>()
    for (const m of visible) {
      const g = map.get(m.designation) ?? {
        designation: m.designation,
        count: 0,
      }
      g.count += m.quantity
      map.set(m.designation, g)
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.designation.localeCompare(b.designation))
  }, [visible])

  // Selected on the drawing → bring its row into view.
  useEffect(() => {
    if (!selectedId) return
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId, grouped])

  const total = members.reduce((sum, m) => sum + m.quantity, 0)
  const number = useMemo(() => new Map(members.map((m, i) => [m.id, i + 1])), [members])

  return (
    <div className="panel">
      <div className="panel__header panel__header--row">
        <div>
          <h2>Quantities</h2>
          <p className="muted">
            {total} {total === 1 ? 'member' : 'members'} · weight per foot from the project’s section data
          </p>
        </div>
        {onAdd && <Button onClick={onAdd}>+ Add member</Button>}
      </div>
      {children}
      <div className="panel__controls">
        <TextField label="Search sections" type="search" placeholder="e.g. W12X26" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="checkbox">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by section
        </label>
      </div>

      {loading && <p className="muted">Loading members…</p>}
      {!loading && members.length === 0 && <p className="muted">No members detected on this page.</p>}
      {!loading && members.length > 0 && visible.length === 0 && <p className="muted">No sections match “{search}”.</p>}

      {grouped && groups.length > 0 && (
        <div className="panel__table">
          <table className="table table--compact">
            <caption className="visually-hidden">Members grouped by section</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col" className="num">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.designation}>
                  <td>
                    <button
                      type="button"
                      className="link-button"
                      onClick={() => {
                        setSearch(g.designation)
                        setGrouped(false)
                      }}
                    >
                      {g.designation}
                    </button>
                  </td>
                  <td className="num">{g.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!grouped && visible.length > 0 && (
        <div className="panel__table">
          <table className="table table--compact quantities">
            <caption className="visually-hidden">Detected members. Select one to show it on the drawing.</caption>
            <thead>
              <tr>
                <th scope="col">Section</th>
                <th scope="col">Length</th>
                <th scope="col" className="num">
                  Qty
                </th>
                <th scope="col" className="num">
                  Wt/ft
                </th>
                <th scope="col">Status</th>
                <th scope="col">Flags</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((m) => {
                const kind = memberKind(m)
                const selected = m.id === selectedId
                return (
                  <tr
                    key={m.id}
                    ref={(el) => {
                      if (el) rowRefs.current.set(m.id, el)
                      else rowRefs.current.delete(m.id)
                    }}
                    data-selected={selected || undefined}
                    data-hovered={m.id === hoveredId || undefined}
                    onPointerEnter={() => onHover(m.id)}
                    onPointerLeave={() => onHover(null)}
                  >
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-pressed={selected}
                        aria-label={`${m.designation}, member ${number.get(m.id)}. Show on drawing`}
                        onClick={() => onSelect(m.id)}
                      >
                        {m.designation}
                      </button>
                    </td>
                    <td className="muted nowrap">
                      {m.length_mm != null ? (
                        m.length_display
                      ) : countedElsewhere(m) ? (
                        <span title="The same column is counted on another sheet: it has no length here and is not in the ABM">
                          {countedElsewhere(m)}
                        </span>
                      ) : isColumnMember(m) ? (
                        <span title="A column's length is its storey height: set the page's level and add it to the project">From levels</span>
                      ) : (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="visually-hidden">Not measured</span>
                        </>
                      )}
                    </td>
                    <td className="num">{m.quantity}</td>
                    <td className="num nowrap">
                      {weightPerFoot(m)?.replace(' lb/ft', '') ?? (
                        <span className="muted" aria-label="No weight">
                          —
                        </span>
                      )}
                    </td>
                    <td className="nowrap">
                      {REVIEW_STATUS[m.review_status].label}
                      {m.is_corrected && <span className="muted"> · corrected</span>}
                    </td>
                    <td className="nowrap">{m.origin === 'manual' ? 'Manual' : memberFlags(m, kind)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

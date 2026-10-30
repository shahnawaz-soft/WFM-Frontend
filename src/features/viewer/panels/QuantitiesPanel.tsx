import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ExtractedMember } from '../../../api/types'
import { Button } from '../../../components/ui/Button'
import { TextField } from '../../../components/ui/Field'
import { REVIEW_STATUS } from '../../review/reviewStatus'
import { countedElsewhere, isColumnMember, labelExtras, lengthNote, matchNote, memberKind, MEMBER_KINDS, sectionName, weightPerFoot } from '../memberAppearance'

interface QuantitiesPanelProps {
  members: ExtractedMember[]
  loading: boolean
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  /** Open a member's edit form (selecting only shows it on the drawing). */
  onEdit?: (id: string) => void
  onHover: (id: string | null) => void
  /** Review progress/actions and the selected member's editor, shown above the list. */
  children?: ReactNode
  onAdd?: () => void
  /** Actions for the members ticked in the list; no tick boxes without it. */
  bulkActions?: (chosen: ExtractedMember[], clear: () => void) => ReactNode
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
export function QuantitiesPanel({ members, loading, selectedId, hoveredId, onSelect, onEdit, onHover, children, onAdd, bulkActions }: QuantitiesPanelProps) {
  const [search, setSearch] = useState('')
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  const query = search.trim().toUpperCase().replace(/\s+/g, '')
  const visible = useMemo(() => (query ? members.filter((m) => m.designation.includes(query)) : members), [members, query])
  // Selected on the drawing → bring its row into view.
  useEffect(() => {
    if (!selectedId) return
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  // Members, not quantities: the totals are the ABM draft's (the estimator's view).
  const total = members.length
  const number = useMemo(() => new Map(members.map((m, i) => [m.id, i + 1])), [members])
  // Ticked members still on the page (a re-run replaces them).
  const chosen = useMemo(() => members.filter((m) => ticked.has(m.id)), [members, ticked])
  const allVisibleTicked = visible.length > 0 && visible.every((m) => ticked.has(m.id))
  const tick = (ids: string[], on: boolean) =>
    setTicked((current) => {
      const next = new Set(current)
      for (const id of ids) {
        if (on) next.add(id)
        else next.delete(id)
      }
      return next
    })

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
      {bulkActions && chosen.length > 0 && bulkActions(chosen, () => setTicked(new Set()))}
      <div className="panel__controls">
        <TextField label="Search sections" type="search" placeholder="e.g. W12X26" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading && <p className="muted">Loading members…</p>}
      {!loading && members.length === 0 && <p className="muted">No members detected on this page.</p>}
      {!loading && members.length > 0 && visible.length === 0 && <p className="muted">No sections match “{search}”.</p>}

      {visible.length > 0 && (
        <div className="panel__table">
          <table className="table table--compact quantities">
            <caption className="visually-hidden">Detected members. Select one to show it on the drawing.</caption>
            <thead>
              <tr>
                {bulkActions && (
                  <th scope="col">
                    <input
                      type="checkbox"
                      aria-label="Choose every member listed"
                      checked={allVisibleTicked}
                      onChange={(e) => tick(visible.map((m) => m.id), e.target.checked)}
                    />
                  </th>
                )}
                <th scope="col">Section</th>
                <th scope="col">Length</th>
                <th scope="col" className="num">
                  Wt/ft
                </th>
                <th scope="col">Status</th>
                <th scope="col">Flags</th>
                {onEdit && (
                  <th scope="col">
                    <span className="visually-hidden">Edit</span>
                  </th>
                )}
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
                    {bulkActions && (
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Choose ${sectionName(m)}, member ${number.get(m.id)}`}
                          checked={ticked.has(m.id)}
                          onChange={(e) => tick([m.id], e.target.checked)}
                        />
                      </td>
                    )}
                    <td>
                      <button
                        type="button"
                        className="link-button"
                        aria-pressed={selected}
                        aria-label={`${sectionName(m)}, member ${number.get(m.id)}. Show on drawing`}
                        onClick={() => onSelect(m.id)}
                      >
                        {m.designation || (
                          <span className="muted nowrap" title="No section label on the drawing for this member (its length is known). Enter the section, or add the sheet that lists it">
                            {sectionName(m)}
                          </span>
                        )}
                      </button>
                      {labelExtras(m) && (
                        <span className="muted nowrap" title="Studs and camber, as printed with the label">
                          {' '}
                          {labelExtras(m)}
                        </span>
                      )}
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
                    {onEdit && (
                      <td>
                        <button
                          type="button"
                          className="link-button"
                          title="Edit"
                          aria-label={`Edit ${sectionName(m)}, member ${number.get(m.id)}`}
                          onClick={() => onEdit(m.id)}
                        >
                          ✎
                        </button>
                      </td>
                    )}
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

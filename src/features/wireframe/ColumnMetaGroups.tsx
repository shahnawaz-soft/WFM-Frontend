import { useState } from 'react'

import type { ColumnMetaGroup, SchedulerRow } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { META_COLOURS, rowsOf } from './metaGroups'

/** The old Wireframer's meta-groups: named groups of columns. A click selects its columns; the
 *  selection becomes a new group with "Group selected". */
export function ColumnMetaGroups({
  groups,
  rows,
  selection,
  canEdit,
  pending,
  error,
  onPick,
  onCreate,
  onDelete,
  creates = true,
}: {
  groups: ColumnMetaGroup[]
  rows: SchedulerRow[]
  selection: Set<string>
  canEdit: boolean
  pending: boolean
  error: string | null
  onPick: (ids: string[]) => void
  onCreate: (name: string) => void
  onDelete: (group: ColumnMetaGroup) => void
  /** Offers "Group Selected" here (the Grid view offers it in its own toolbar). */
  creates?: boolean
}) {
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const create = () => {
    if (!name.trim()) return
    onCreate(name.trim())
    setName('')
    setNaming(false)
  }
  return (
    <section className="col-meta" aria-label="Meta-groups">
      <h3 className="col-meta__title">Meta-Groups ({groups.length})</h3>
      {groups.length > 0 && (
        <ul className="col-meta__list">
          {groups.map((g, i) => {
            const here = rowsOf(g, rows)
            return (
              <li key={g.id}>
                <button type="button" className="col-meta__pick" onClick={() => onPick(here.map((r) => r.id))}>
                  <span className="col-meta__swatch" style={{ background: META_COLOURS[i % META_COLOURS.length] }} aria-hidden="true" />
                  <strong>{g.name}</strong>
                  <span className="muted">
                    {here.length} column{here.length === 1 ? '' : 's'}
                    {here.length < g.members.length ? ` (${g.members.length - here.length} not in this revision)` : ''}
                  </span>
                </button>
                {canEdit && (
                  <button type="button" className="link-button" aria-label={`Delete meta-group ${g.name}`} onClick={() => onDelete(g)}>
                    ×
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {creates && canEdit && selection.size > 1 && !naming && (
        <Button onClick={() => setNaming(true)}>➕ Group Selected ({selection.size})</Button>
      )}
      {naming && (
        <div className="col-meta__new">
          <input
            aria-label="Meta-group name"
            placeholder="Meta-group name…"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') create()
              if (e.key === 'Escape') setNaming(false)
            }}
          />
          <Button variant="primary" loading={pending} disabled={!name.trim()} onClick={create}>
            Create
          </Button>
          <Button onClick={() => setNaming(false)}>Cancel</Button>
        </div>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useParams } from 'react-router'

import { toApiError } from '../../api/errors'
import { getProject } from '../../api/projects'
import { getRevision, pairSheet } from '../../api/revisions'
import type { RevisionReport } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { SelectField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { StatusTone } from '../../components/ui/StatusIcon'
import { projectCan } from '../projects/useProjectPermissions'

type SheetRow = RevisionReport['sheets'][number]
type ChangeRow = SheetRow['changes'][number]
type MemberRow = NonNullable<ChangeRow['original']>

const KIND: Record<ChangeRow['kind'], { label: string; tone: StatusTone }> = {
  added: { label: 'Added', tone: 'success' },
  removed: { label: 'Removed', tone: 'error' },
  changed: { label: 'Changed', tone: 'warning' },
}

const METHOD: Record<string, { label: string; tone: StatusTone }> = {
  sheet_number: { label: 'Matched by sheet number', tone: 'success' },
  title: { label: 'Matched by sheet title', tone: 'info' },
  page_order: { label: 'Matched by page order: check it', tone: 'warning' },
  person: { label: 'Paired by a person', tone: 'neutral' },
}

const WHAT: Record<string, string> = { size: 'size', length: 'length', quantity: 'quantity', studs: 'studs', camber: 'camber' }

function lb(value: string | null | undefined, signed = true): string {
  if (value == null) return '—'
  const n = Number(value)
  const text = `${Math.round(Math.abs(n)).toLocaleString()} lb`
  return signed && n !== 0 ? `${n > 0 ? '+' : '−'}${text}` : text
}

function sheetName(sheet: SheetRow['original']): string {
  if (!sheet) return ''
  return `${sheet.sheet_number || sheet.title || 'Sheet'} · p.${sheet.page_number}`
}

/** What changed between a revised drawing set and the set it revises: per sheet, every added,
 *  removed and changed member, with the weight it adds or takes off. */
export function RevisionPage() {
  const { projectId = '', setId = '' } = useParams()
  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const report = useQuery({ queryKey: ['revision', setId], queryFn: () => getRevision(setId) })
  const [onlyChanged, setOnlyChanged] = useState(true)

  const error = project.error ?? report.error
  if (error) {
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">No comparison</h1>
        <p>This drawing set doesn't revise another one, or it is not in a project you can see.</p>
        <Link to={`/projects/${projectId}`}>Back to the project</Link>
      </div>
    ) : (
      <ErrorState title="Could not compare the revision" error={error} />
    )
  }
  if (!project.data || !report.data) return <LoadingState label="Comparing the sheets…" />

  const r = report.data
  const s = r.summary
  const canEdit = projectCan(project.data, 'project.edit')
  const sheets = onlyChanged ? r.sheets.filter((row) => row.status !== 'compared' || row.changes.length > 0) : r.sheets
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/projects/${projectId}`}>{project.data.name}</Link>
      </nav>
      <div className="page-header">
        <div>
          <h1>Revision: {r.revision.original_filename}</h1>
          <p className="muted">
            Compared with <strong>{r.original.original_filename}</strong>, sheet by sheet. The original side is the estimate as
            reviewed; the revised side is what Steelo read from the new sheets.
          </p>
        </div>
      </div>

      <dl className="kpis revision__kpis" aria-label="What changed">
        {(
          [
            ['Added', s.added],
            ['Removed', s.removed],
            ['Changed', s.changed],
            ['Unchanged', s.unchanged],
          ] as [string, number][]
        ).map(([label, n]) => (
          <div className="kpi" key={label}>
            <dt className="kpi__label">{label}</dt>
            <dd className="kpi__value">{n}</dd>
          </div>
        ))}
        <div className="kpi">
          <dt className="kpi__label">Weight change</dt>
          <dd className="kpi__value">{lb(s.weight_delta_lb)}</dd>
          {s.unweighed_changes > 0 && <dd className="kpi__sub">{s.unweighed_changes} changes can't be weighed</dd>}
        </div>
      </dl>

      {s.sheets_not_run > 0 && (
        <p className="notice notice--warning" role="note">
          {s.sheets_not_run} revised {s.sheets_not_run === 1 ? 'sheet has' : 'sheets have'} not been run yet: run Run Plan on{' '}
          {s.sheets_not_run === 1 ? 'it' : 'them'} on the <Link to={`/projects/${projectId}`}>project page</Link> to compare
          {s.sheets_not_run === 1 ? ' it' : ' them'}.
        </p>
      )}
      <p className="muted">
        {s.sheets_compared} sheets compared · {s.sheets_new} new · {s.sheets_removed} no longer in the set
      </p>
      <label className="checkbox">
        <input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only sheets with
        changes
      </label>

      {sheets.length === 0 && <p className="muted">No sheet changed.</p>}
      {sheets.map((row) => (
        <SheetCard
          key={`${row.original?.page_id ?? ''}|${row.revised?.page_id ?? ''}`}
          projectId={projectId}
          setId={setId}
          row={row}
          originals={r.sheets.flatMap((x) => (x.original ? [x.original] : []))}
          canEdit={canEdit}
        />
      ))}
    </>
  )
}

function SheetCard({
  projectId,
  setId,
  row,
  originals,
  canEdit,
}: {
  projectId: string
  setId: string
  row: SheetRow
  originals: NonNullable<SheetRow['original']>[]
  canEdit: boolean
}) {
  const queryClient = useQueryClient()
  const pair = useMutation({
    mutationFn: (originalPage: string | null) => pairSheet(setId, row.revised!.page_id, originalPage),
    meta: { successMessage: 'Sheets re-paired' },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['revision', setId] }),
  })
  const title = row.revised
    ? row.original
      ? `${sheetName(row.revised)} (was ${sheetName(row.original)})`
      : `${sheetName(row.revised)}: new sheet`
    : `${sheetName(row.original)}: no longer in the set`
  const method = METHOD[row.method]
  return (
    <section className="card revision__sheet" aria-label={title}>
      <div className="card__header">
        <h2 className="revision__sheet-title">{title}</h2>
        <div className="revision__badges">
          {method && <StatusBadge tone={method.tone} label={method.label} />}
          {row.status === 'not_run' && <StatusBadge tone="warning" label="Run Plan to compare" />}
        </div>
      </div>
      {row.status === 'compared' && (
        <p className="muted">
          {row.counts.added} added · {row.counts.removed} removed · {row.counts.changed} changed · {row.counts.unchanged}{' '}
          unchanged · weight {lb(row.weight_delta_lb)}
          {row.notes.includes('no_shared_grid') && ' · no grid crossing on both sheets: matched by place on the paper'}
          {row.notes.includes('scale_changed') && ' · the drawing scale changed'}
        </p>
      )}
      {canEdit && row.revised && (
        <div className="revision__pair">
          <SelectField
            label="Revises sheet"
            value={row.original?.page_id ?? ''}
            disabled={pair.isPending}
            onChange={(e) => pair.mutate(e.target.value || null)}
            options={[
              { value: '', label: 'None: a new sheet' },
              ...originals.map((o) => ({ value: o.page_id, label: sheetName(o) })),
            ]}
          />
        </div>
      )}
      {row.changes.length > 0 && (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">Changes on {title}</caption>
            <thead>
              <tr>
                <th scope="col">Change</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">What changed</th>
                <th scope="col" className="num">
                  Weight
                </th>
                <th scope="col">
                  <span className="visually-hidden">Show</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {row.changes.map((c) => {
                const shown = c.revised ?? c.original!
                return (
                  <tr key={`${c.original?.id ?? ''}|${c.revised?.id ?? ''}`}>
                    <td>
                      <StatusBadge tone={KIND[c.kind].tone} label={KIND[c.kind].label} />
                    </td>
                    <td>{c.original ? <Member m={c.original} /> : <span className="muted">—</span>}</td>
                    <td>{c.revised ? <Member m={c.revised} /> : <span className="muted">—</span>}</td>
                    <td>{c.what.map((w) => WHAT[w] ?? w).join(', ') || <span className="muted">—</span>}</td>
                    <td className="num nowrap">{lb(c.weight_delta_lb)}</td>
                    <td>
                      <Link to={`/projects/${projectId}/pages/${shown.page}?member=${shown.id}`}>
                        Show on {c.revised ? 'revised' : 'original'} sheet
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Member({ m }: { m: MemberRow }) {
  const extras = [m.length_display, m.quantity > 1 ? `×${m.quantity}` : '', m.studs_text ? `(${m.studs_text})` : '', m.camber_display ? `C=${m.camber_display}` : '']
  return (
    <span className="revision__member">
      <strong>{m.designation || 'No size'}</strong> <span className="muted">{extras.filter(Boolean).join(' ')}</span>
    </span>
  )
}

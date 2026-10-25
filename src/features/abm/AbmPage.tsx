import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { downloadDraftAbm, getAbmSummary, getAbmTotals, listAbm, listBeamMarks } from '../../api/abm'
import { getPage } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import { getMember } from '../../api/members'
import { getProject } from '../../api/projects'
import type { AbmEntry, AbmSummary, AbmTotals, ExtractedMember } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { FormAlert, SelectField, TextField } from '../../components/ui/Field'
import { AbmExport } from '../finalize/AbmExport'
import { projectCan } from '../projects/useProjectPermissions'
import { AddMemberForm } from '../review/AddMemberForm'
import { ConnectionJump, ConnectionPanel } from '../connections/ConnectionPanel'
import { MemberEditor } from '../review/MemberEditor'
import type { FocusRequest } from '../viewer/DrawingStage'
import { AbmTable } from './AbmTable'
import { AbmTotalsView } from './AbmTotalsView'
import { BeamMarks } from './BeamMarks'
import {
  activeCount,
  CONFIDENCE_OPTIONS,
  EMPTY,
  fromSearch,
  MATCH_OPTIONS,
  PAGE_SIZE,
  SOURCE_OPTIONS,
  STATUS_OPTIONS,
  toApi,
  toSearch,
  type FilterState,
} from './filters'
import { formatTonnes, formatTons, type Amounts } from './format'

const SEARCH_DELAY_MS = 300

// Lazy: the drawing pane needs PDF.js; the table and filters render without waiting for it.
const AbmDrawing = lazy(() => import('./AbmDrawing').then((m) => ({ default: m.AbmDrawing })))

/** The project's interactive ABM (PRD §4.3): every entry of the pages added to
 *  the project, searchable and filterable, linked both ways with its source drawing. */
export function AbmPage() {
  const { projectId = '' } = useParams()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const filters = useMemo(() => fromSearch(params), [params])
  const selectedId = params.get('member')
  const viewParam = params.get('view')
  const view = viewParam === 'totals' || viewParam === 'marks' ? viewParam : 'entries'
  // Draft: every page that has been run, without reviewing or adding each one (18 Oct 2026).
  const draft = params.get('draft') === '1'
  const [downloading, setDownloading] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(() => (selectedId ? { memberId: selectedId, nonce: 1 } : null))
  const [adding, setAdding] = useState<{ pageId: string; location: [number, number] | null } | null>(null)
  const [placing, setPlacing] = useState(false)

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const summary = useQuery({ queryKey: ['abm', projectId, 'summary', draft], queryFn: () => getAbmSummary(projectId, draft) })
  const totals = useQuery({ queryKey: ['abm', projectId, 'totals', draft], queryFn: () => getAbmTotals(projectId, draft) })
  // Beams the drawings name by a mark only: a tab of their own, when there are any.
  const beamMarks = useQuery({ queryKey: ['beam-marks', projectId], queryFn: () => listBeamMarks(projectId) })
  const apiFilters = useMemo(() => ({ ...toApi(filters), draft }), [filters, draft])
  const entries = useQuery({
    queryKey: ['abm', projectId, 'entries', apiFilters],
    queryFn: () => listAbm(projectId, apiFilters),
    placeholderData: keepPreviousData,
  })
  const results = useMemo(() => entries.data?.results ?? [], [entries.data])
  const inList = results.find((e) => e.id === selectedId)
  // Selected on the drawing (or linked from elsewhere) but not in the current list.
  const fetched = useQuery({
    queryKey: ['member', selectedId],
    queryFn: () => getMember(selectedId!),
    enabled: Boolean(selectedId) && !inList && entries.isSuccess,
  })
  const selected: ExtractedMember | null = inList ?? (fetched.data?.id === selectedId ? fetched.data : null) ?? null

  const pages = summary.data?.pages ?? []
  const drawingPageId = adding?.pageId ?? selected?.page ?? (filters.page || results[0]?.page || pages[0]?.id) ?? null
  const drawingPage = useQuery({
    queryKey: ['drawing-page', drawingPageId],
    queryFn: () => getPage(drawingPageId!),
    enabled: Boolean(drawingPageId),
  })
  const fileName = pages.find((p) => p.id === drawingPageId)?.drawing_set.original_filename ?? ''

  const update = useCallback(
    (patch: Partial<FilterState>) => setParams((p) => toSearch({ ...fromSearch(p), offset: 0, ...patch }, p), { replace: true }),
    [setParams],
  )
  const select = useCallback(
    (id: string | null, fromList = false) => {
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          if (id) next.set('member', id)
          else next.delete('member')
          return next
        },
        { replace: true },
      )
      if (id && fromList) setFocus((f) => ({ memberId: id, nonce: (f?.nonce ?? 1) + 1 }))
    },
    [setParams],
  )
  const changed = useCallback(
    (member: ExtractedMember) => {
      queryClient.setQueryData(['member', member.id], member)
      void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
      void queryClient.invalidateQueries({ queryKey: ['drawing-page', member.page, 'members'] })
    },
    [queryClient, projectId],
  )
  const refetchAll = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['abm', projectId] })
    void queryClient.invalidateQueries({ queryKey: ['member', selectedId] })
  }, [queryClient, projectId, selectedId])
  const setDraft = useCallback(
    (on: boolean) =>
      setParams(
        (p) => {
          const out = new URLSearchParams(p)
          if (on) out.set('draft', '1')
          else out.delete('draft')
          out.delete('offset')
          out.delete('page')
          return out
        },
        { replace: true },
      ),
    [setParams],
  )
  const downloadDraft = useCallback(async () => {
    setDownloading(true)
    try {
      await downloadDraftAbm(projectId, `${(project.data?.name ?? 'project').replace(/[^A-Za-z0-9]+/g, '-')}-ABM-draft.xlsx`)
    } finally {
      setDownloading(false)
    }
  }, [projectId, project.data?.name])
  const setView = useCallback(
    (next: 'entries' | 'totals' | 'marks') =>
      setParams(
        (p) => {
          const out = new URLSearchParams(p)
          if (next !== 'entries') out.set('view', next)
          else out.delete('view')
          return out
        },
        { replace: true },
      ),
    [setParams],
  )
  // From a number in Totals to the entries behind it.
  const showEntries = useCallback(
    (patch: Partial<FilterState>) =>
      setParams((p) => {
        const out = toSearch({ ...EMPTY, ordering: fromSearch(p).ordering, ...patch }, p)
        out.delete('view')
        return out
      }),
    [setParams],
  )
  const cancelPlace = useCallback(() => setPlacing(false), [])
  const place = useCallback((location: [number, number]) => {
    setPlacing(false)
    setAdding((a) => (a ? { ...a, location } : a))
  }, [])

  if (project.error || summary.error) {
    const error = project.error ?? summary.error
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not open the ABM" error={error!} />
    )
  }
  if (!project.data || !summary.data) return <LoadingState label="Opening ABM…" />

  const canEdit = projectCan(project.data, 'project.edit')
  const count = entries.data?.count ?? 0
  const rowNumber = inList ? filters.offset + results.indexOf(inList) + 1 : null

  return (
    <div className="abm">
      <header className="abm__header">
        <div>
          <nav aria-label="Breadcrumb" className="breadcrumb">
            <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/projects/${projectId}`}>{project.data.name}</Link>
          </nav>
          <h1>ABM</h1>
          {project.data.status === 'finalized' && (
            <p className="notice notice--compact" role="status">
              Finalised and read-only. Reopen the project from its page to make changes.
            </p>
          )}
          <label className="checkbox abm__draft-toggle">
            <input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Show every processed page
            (draft, before review)
          </label>
          {draft && (
            <p className="notice notice--compact" role="status">
              Draft ABM: every page that has been run, reviewed or not. It is not a final figure; finalising uses the pages
              added to the project.
            </p>
          )}
          <SummaryStats summary={summary.data} totals={totals.data} draft={draft} />
        </div>
        <div className="button-row button-row--tight abm__actions">
          {draft && pages.length > 0 && (
            <Button loading={downloading} onClick={() => void downloadDraft()}>
              Download draft (Excel)
            </Button>
          )}
          {!draft && pages.length > 0 && <AbmExport project={project.data} />}
          {canEdit && pages.length > 0 && (
            <Button
              variant="primary"
              disabled={Boolean(adding)}
              onClick={() => {
                select(null)
                setAdding({ pageId: drawingPageId ?? pages[0]!.id, location: null })
              }}
            >
              + Add entry
            </Button>
          )}
        </div>
      </header>

      {pages.length === 0 ? (
        <NoPagesYet projectId={projectId} summary={summary.data} />
      ) : (
        <div className="abm__body">
          <section className="abm__list" aria-label={view === 'totals' ? 'Totals' : 'Entries'}>
            <div className="family-tabs abm__views" role="group" aria-label="Show">
              <button type="button" aria-pressed={view === 'entries'} onClick={() => setView('entries')}>
                Entries
              </button>
              <button type="button" aria-pressed={view === 'totals'} onClick={() => setView('totals')}>
                Totals by section
              </button>
              {(beamMarks.data?.length ?? 0) > 0 && (
                <button type="button" aria-pressed={view === 'marks'} onClick={() => setView('marks')}>
                  Beam marks <span className="family-tabs__count">{beamMarks.data!.length}</span>
                </button>
              )}
            </div>
            {view === 'marks' && beamMarks.data ? (
              <BeamMarks projectId={projectId} marks={beamMarks.data} canEdit={canEdit} />
            ) : view === 'totals' ? (
              totals.data ? (
                <AbmTotalsView totals={totals.data} onShow={showEntries} />
              ) : totals.error ? (
                <ErrorState title="Could not load the totals" error={totals.error} onRetry={() => void totals.refetch()} />
              ) : (
                <LoadingState label="Calculating totals…" />
              )
            ) : (
              <>
                <Filters filters={filters} summary={summary.data} onChange={update} />
                {entries.error && (
                  <FormAlert
                    message={`${toApiError(entries.error).message} ${Object.values(toApiError(entries.error).details ?? {})
                      .flat()
                      .join(' ')}`}
                  />
                )}
                <div className="abm__table" aria-busy={entries.isFetching || undefined}>
                  {entries.isPending && <LoadingState label="Loading entries…" />}
                  {entries.isSuccess && count === 0 && (
                    <p className="muted abm__empty">
                      {activeCount(filters) ? 'No entries match these filters.' : 'No entries yet.'}
                    </p>
                  )}
                  {results.length > 0 && (
                    <AbmTable
                      entries={results}
                      firstNumber={filters.offset + 1}
                      selectedId={selectedId}
                      hoveredId={hoveredId}
                      ordering={filters.ordering}
                      onSort={(ordering) => update({ ordering })}
                      onSelect={(entry: AbmEntry) => select(entry.id, true)}
                      onHover={setHoveredId}
                    />
                  )}
                </div>
                {count > 0 && (
                  <nav className="pagination abm__pagination" aria-label="Pages of entries">
                    <span className="muted" aria-live="polite">
                      {filters.offset + 1}–{Math.min(filters.offset + PAGE_SIZE, count)} of {count}{' '}
                      {count === 1 ? 'entry' : 'entries'}
                    </span>
                    <Button disabled={filters.offset === 0} onClick={() => update({ offset: Math.max(0, filters.offset - PAGE_SIZE) })}>
                      ← Previous
                    </Button>
                    <Button disabled={filters.offset + PAGE_SIZE >= count} onClick={() => update({ offset: filters.offset + PAGE_SIZE })}>
                      Next →
                    </Button>
                  </nav>
                )}
              </>
            )}
          </section>

          <aside className="abm__side" aria-label="Selected entry and drawing">
            {(adding || selected) && (
              <div className="abm__detail">
                {adding ? (
                  <>
                    <SelectField
                      label="Add to page"
                      value={adding.pageId}
                      onChange={(e) => setAdding({ pageId: e.target.value, location: null })}
                      options={pages.map((p) => ({ value: p.id, label: `Page ${p.page_number} · ${p.drawing_set.original_filename}` }))}
                    />
                    <AddMemberForm
                      key={adding.pageId}
                      pageId={adding.pageId}
                      location={adding.location}
                      onPickLocation={() => setPlacing(true)}
                      onAdded={(member) => {
                        setAdding(null)
                        setPlacing(false)
                        changed(member)
                        select(member.id, true)
                      }}
                      onCancel={() => {
                        setAdding(null)
                        setPlacing(false)
                      }}
                    />
                  </>
                ) : (
                  selected && (
                    <>
                      {inList && <ConnectionJump projectId={projectId} member={selected} />}
                      <MemberEditor
                        key={selected.id}
                        member={selected}
                        index={rowNumber ?? 0}
                        subtitle={rowNumber ? `entry ${rowNumber}` : inList ? undefined : 'not in the current list'}
                        canEdit={canEdit}
                        locked={drawingPage.data?.status === 'reviewed'}
                        onSaved={changed}
                        onStale={refetchAll}
                        onClose={() => select(null)}
                      />
                      {inList && <ConnectionPanel projectId={projectId} member={selected} canEdit={canEdit} />}
                      {!inList && selected.review_status === 'rejected' && (
                        <p className="muted">Rejected members are not in the ABM. Accept it to bring it back.</p>
                      )}
                    </>
                  )
                )}
              </div>
            )}
            <div className="abm__drawing">
              {drawingPageId && (
                <Suspense fallback={<LoadingState label="Opening drawing…" />}>
                  <AbmDrawing
                    projectId={projectId}
                    pageId={drawingPageId}
                    fileName={fileName}
                    selectedId={selectedId}
                    hoveredId={hoveredId}
                    focus={focus}
                    onSelect={(id) => !adding && select(id)}
                    onHover={setHoveredId}
                    placing={placing}
                    onPlace={place}
                    onCancelPlace={cancelPlace}
                  />
                </Suspense>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

/** Reviewed + awaiting review: in a draft nearly nothing is reviewed yet, so this is its total. */
function draftWeight(totals: AbmTotals): Amounts {
  const add = (k: keyof Amounts) => String(Number(totals.reviewed.weight[k]) + Number(totals.incomplete.weight[k]))
  return { lb: add('lb'), kg: add('kg'), short_tons: add('short_tons'), tonnes: add('tonnes') }
}

function SummaryStats({ summary, totals, draft = false }: { summary: AbmSummary; totals?: AbmTotals; draft?: boolean }) {
  const stats: [string, number][] = [
    ['Entries', summary.entries],
    ['Quantity', summary.quantity],
    ['Accepted', summary.accepted],
    ['Awaiting review', summary.open],
    ['Unsupported', summary.unsupported],
    ['Corrected', summary.corrected],
    ['Manual', summary.manual],
    ['Removed', summary.rejected],
  ]
  return (
    <>
      <dl className="abm-stats" aria-label="ABM summary">
        {totals && draft && (
          <div className="abm-stats__tonnage" title={formatTonnes(draftWeight(totals))}>
            <dt>Draft tonnage</dt>
            <dd>
              {formatTons(draftWeight(totals))}
              <span className="abm-stats__flag"> · not reviewed</span>
            </dd>
          </div>
        )}
        {totals && !draft && (
          <div className="abm-stats__tonnage" title={formatTonnes(totals.reviewed.weight)}>
            <dt>Reviewed tonnage</dt>
            <dd>
              {formatTons(totals.reviewed.weight)}
              {!totals.complete && <span className="abm-stats__flag"> · not complete</span>}
            </dd>
          </div>
        )}
        {stats.map(([label, value]) => (
          <div key={label} data-attention={(label === 'Awaiting review' || label === 'Unsupported') && value > 0 ? true : undefined}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p className="muted abm__note">
        From {summary.pages.length} {summary.pages.length === 1 ? 'page' : 'pages'} added to the project. Tonnage counts
        accepted entries only; see Totals by section for what is not final yet.
        {summary.pages_reviewed > 0 &&
          ` ${summary.pages_reviewed} reviewed ${summary.pages_reviewed === 1 ? 'page is' : 'pages are'} not added yet.`}
      </p>
    </>
  )
}

function NoPagesYet({ projectId, summary }: { projectId: string; summary: AbmSummary }) {
  return (
    <div className="state state--empty abm__empty-state">
      <h2 className="state__title">No pages in the ABM yet</h2>
      <p>
        Open a processed page, review its members, choose <strong>Mark page reviewed</strong>, then{' '}
        <strong>Add to project</strong>. Its members then appear here.
      </p>
      {(summary.pages_reviewed > 0 || summary.pages_processed > 0) && (
        <p className="muted">
          {summary.pages_reviewed} reviewed and {summary.pages_processed} processed{' '}
          {summary.pages_processed === 1 ? 'page is' : 'pages are'} waiting.
        </p>
      )}
      <Link to={`/projects/${projectId}`}>Back to the project</Link>
    </div>
  )
}

function Filters({ filters, summary, onChange }: { filters: FilterState; summary: AbmSummary; onChange: (patch: Partial<FilterState>) => void }) {
  const [search, setSearch] = useState(filters.search)
  const advancedInUse = Boolean(
    filters.match || filters.confidence || filters.length_min || filters.length_max || filters.length_missing || filters.quantity_min || filters.quantity_max,
  )
  const [more, setMore] = useState(advancedInUse)

  // Typing updates the list after a short pause, not on every key.
  useEffect(() => {
    if (search === filters.search) return
    const timer = setTimeout(() => onChange({ search }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [search, filters.search, onChange])

  const active = activeCount(filters)
  return (
    <div className="abm-filters" role="search" aria-label="Filter entries">
      <div className="abm-filters__row">
        <TextField
          label="Search"
          type="search"
          placeholder="Section, mark or type"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectField
          label="Section type"
          value={filters.profile}
          onChange={(e) => onChange({ profile: e.target.value })}
          options={[{ value: '', label: 'All types' }, ...summary.profiles.map((g) => ({ value: g.profile, label: `${g.profile} (${g.quantity})` }))]}
        />
        <SelectField
          label="Page"
          value={filters.page}
          onChange={(e) => onChange({ page: e.target.value })}
          options={[
            { value: '', label: 'All pages' },
            ...summary.pages.map((p) => ({ value: p.id, label: `p.${p.page_number} · ${p.drawing_set.original_filename} (${p.entries})` })),
          ]}
        />
        <SelectField label="Status" value={filters.status} onChange={(e) => onChange({ status: e.target.value })} options={STATUS_OPTIONS} />
        <SelectField label="Values" value={filters.source} onChange={(e) => onChange({ source: e.target.value })} options={SOURCE_OPTIONS} />
        <label
          className="checkbox"
          title="Entries to look at before sending the ABM: no length, a length flagged as doubtful, or a column without its section"
        >
          <input type="checkbox" checked={filters.to_check} onChange={(e) => onChange({ to_check: e.target.checked })} /> To check
        </label>
        <div className="abm-filters__buttons">
          <Button aria-expanded={more} aria-controls="abm-more-filters" onClick={() => setMore((m) => !m)}>
            More filters
          </Button>
          {active > 0 && (
            <Button
              onClick={() => {
                setSearch('')
                onChange({ ...EMPTY, ordering: filters.ordering })
              }}
            >
              Clear filters ({active})
            </Button>
          )}
        </div>
      </div>
      {filters.designation && (
        <p className="abm-filters__chip">
          Section <strong>{filters.designation}</strong>{' '}
          <Button aria-label={`Stop showing only ${filters.designation}`} onClick={() => onChange({ designation: '' })}>
            ×
          </Button>
        </p>
      )}
      {more && (
        <div
          className="abm-filters__row"
          id="abm-more-filters"
          // Typed fields apply on blur; remount them when the filters are cleared elsewhere.
          key={[filters.length_min, filters.length_max, filters.quantity_min, filters.quantity_max].join('|')}
        >
          <TextField
            label="Shortest length"
            placeholder={'e.g. 10\'-0"'}
            defaultValue={filters.length_min}
            onBlur={(e) => onChange({ length_min: e.target.value })}
          />
          <TextField
            label="Longest length"
            placeholder="e.g. 9000 mm"
            defaultValue={filters.length_max}
            onBlur={(e) => onChange({ length_max: e.target.value })}
          />
          <label className="checkbox">
            <input type="checkbox" checked={filters.length_missing} onChange={(e) => onChange({ length_missing: e.target.checked })} /> No
            length
          </label>
          <TextField
            label="Min qty"
            type="number"
            min={1}
            defaultValue={filters.quantity_min}
            onBlur={(e) => onChange({ quantity_min: e.target.value })}
          />
          <TextField
            label="Max qty"
            type="number"
            min={1}
            defaultValue={filters.quantity_max}
            onBlur={(e) => onChange({ quantity_max: e.target.value })}
          />
          <SelectField label="Section match" value={filters.match} onChange={(e) => onChange({ match: e.target.value })} options={MATCH_OPTIONS} />
          <SelectField
            label="Confidence"
            value={filters.confidence}
            onChange={(e) => onChange({ confidence: e.target.value })}
            options={CONFIDENCE_OPTIONS}
          />
        </div>
      )}
    </div>
  )
}

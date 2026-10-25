import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'

import { toApiError } from '../../api/errors'
import { getProject } from '../../api/projects'
import type { Wireframe, WireframeElement } from '../../api/types'
import {
  copyWireframe,
  generateWireframe,
  getSchedulerColumns,
  getWireframeSetup,
  listWireframeElements,
  listWireframes,
  markWireframeReviewed,
} from '../../api/wireframe'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { StatusTone } from '../../components/ui/StatusIcon'
import { signedFeetInches } from '../abm/format'
import { projectCan } from '../projects/useProjectPermissions'
import { AddElementForm, ElementPanel } from './ElementPanel'
import { describeColumn } from '../viewer/columnSymbols'
import { ColumnScheduler } from './ColumnScheduler'
import { IsometricPreview } from './IsometricPreview'
import { LevelProposalsCard } from './LevelProposals'
import type { CameraView } from './Wireframe3D'

/** Built from every page that has been run, not only pages added to the project. */
const isDraftBuild = (w: Wireframe) => Boolean((w as Wireframe & { draft?: boolean }).draft)

// three.js loads only when the 3D view is shown.
const Wireframe3D = lazy(() => import('./Wireframe3D'))

const POLL_MS = 1500

const MISSING_LABELS: Record<string, string> = {
  level_missing: 'elevation',
  reference_missing: 'reference grid point',
  scale_missing: 'drawing scale',
  reference_unaligned: 'a reference crossing the other plans show',
}

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  generating: { label: 'Generating…', tone: 'info' },
  draft: { label: 'Draft', tone: 'neutral' },
  reviewed: { label: 'Reviewed', tone: 'success' },
  failed: { label: 'Failed', tone: 'error' },
}

const COMPLETENESS: Record<string, { label: string; tone: StatusTone }> = {
  ok: { label: 'Placed', tone: 'success' },
  missing_data: { label: 'Missing data', tone: 'warning' },
  unsupported: { label: 'Not in 3D', tone: 'neutral' },
}

/** The same column drawn from another plan of its storey: kept for the record, not missing. */
const isCopy = (e: WireframeElement) => e.issues.includes('same_column')

const point = (p: string[] | null) => (p ? p.map(signedFeetInches).join(', ') : '—')

/** Generate and inspect the project's 3D wireframe (PRD §4.5; OD-10). */
export function WireframePage() {
  const { projectId = '' } = useParams()
  const queryClient = useQueryClient()
  const [chosen, setChosen] = useState<string | null>(null)
  const [params] = useSearchParams()
  const linkedMember = params.get('member')
  const openTab = params.get('tab') === 'columns' ? 'columns' : 'elements'

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const setup = useQuery({ queryKey: ['wireframe-setup', projectId], queryFn: () => getWireframeSetup(projectId) })
  const revisions = useQuery({
    queryKey: ['wireframes', projectId],
    queryFn: () => listWireframes(projectId),
    refetchInterval: (q) => (q.state.data?.some((w) => w.status === 'generating') ? POLL_MS : false),
  })
  const current: Wireframe | undefined = revisions.data?.find((w) => w.id === chosen) ?? revisions.data?.[0]
  const generate = useMutation({
    mutationFn: (draft: boolean) => generateWireframe(projectId, { draft }),
    meta: { successMessage: 'Generating the wireframe' },
    onSuccess: (w) => {
      setChosen(w.id)
      void queryClient.invalidateQueries({ queryKey: ['wireframes', projectId] })
    },
  })
  const error = project.error ?? setup.error ?? revisions.error
  if (error) {
    return toApiError(error).status === 404 ? (
      <div className="state state--empty">
        <h1 className="state__title">Project not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <Link to="/projects">Back to projects</Link>
      </div>
    ) : (
      <ErrorState title="Could not open the wireframe" error={error} />
    )
  }
  if (!project.data || !setup.data || !revisions.data) return <LoadingState label="Opening wireframe…" />

  const canEdit = projectCan(project.data, 'project.edit')
  const pages = setup.data.pages
  const generating = revisions.data.some((w) => w.status === 'generating')
  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
        <Link to={`/projects/${projectId}`}>{project.data.name}</Link>
      </nav>
      <div className="page-header">
        <div>
          <h1>Wireframe</h1>
          <p className="muted">A 3D starting point for modelling, built from the members in the ABM.</p>
        </div>
        {canEdit && (
          <div className="page-header__action">
            <Button
              variant="primary"
              loading={generate.isPending || generating}
              disabled={!pages.length}
              aria-describedby={pages.length ? undefined : 'wireframe-needs-pages'}
              onClick={() => generate.mutate(false)}
            >
              {revisions.data.length ? 'Generate again' : 'Generate wireframe'}
            </Button>
            <Button
              loading={generate.isPending || generating}
              onClick={() => generate.mutate(true)}
              title="Build from every page that has been run (with its level set), without adding pages to the project. For checking only: the wireframe to issue is built from added pages."
            >
              Generate draft (all run pages)
            </Button>
            {!pages.length && (
              <p id="wireframe-needs-pages" className="page-header__hint">
                Built from pages added to the project. Review a page, then choose Add to project on the{' '}
                <Link to={`/projects/${projectId}`}>project page</Link>.
              </p>
            )}
          </div>
        )}
      </div>

      <p className="notice" role="note">
        <strong>This is a starting wireframe, not a detailed model.</strong> It shows member centrelines only. Sectional
        steel, section details, connections and brace elevations are not represented, and members that could not be
        placed are listed below as missing.
      </p>
      {generate.error && <p className="field__error">{toApiError(generate.error).message}</p>}

      <section className="card" aria-labelledby="wf-setup">
        <div className="card__header">
          <h2 id="wf-setup">Level set-up</h2>
          {setup.data.ready && <StatusBadge tone="success" label="Every page is set up" />}
        </div>
        {pages.length === 0 ? (
          <p className="muted">No pages in the project yet. Review pages and choose Add to project first.</p>
        ) : (
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Pages in the project and their level set-up</caption>
              <thead>
                <tr>
                  <th scope="col">Page</th>
                  <th scope="col">Level</th>
                  <th scope="col">Elevation</th>
                  <th scope="col">Reference</th>
                  <th scope="col">Scale</th>
                  <th scope="col">Columns found</th>
                  <th scope="col">Still needed</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => (
                  <tr key={p.id}>
                    <th scope="row">
                      <Link to={`/projects/${projectId}/pages/${p.id}?tab=level`}>
                        Page {p.page_number} · {p.original_filename}
                      </Link>
                    </th>
                    <td>{p.level_label || <span className="muted">—</span>}</td>
                    <td>{p.elevation_mm != null ? p.elevation_display || '0' : <span className="muted">—</span>}</td>
                    <td>{p.has_reference_point ? p.reference_label || 'Set' : <span className="muted">—</span>}</td>
                    <td>{p.scale_ratio ? `1:${p.scale_ratio}` : <span className="muted">Unknown</span>}</td>
                    <td>
                      {p.columns != null ? (
                        p.columns
                      ) : p.scale_ratio ? (
                        <span className="muted">Looked for when generating</span>
                      ) : (
                        <span className="muted">Needs the scale</span>
                      )}
                    </td>
                    <td>
                      {!p.placed_in_3d ? (
                        <span className="muted">Nothing: {p.sheet_kind ?? 'not a plan'} sheet, its members are not placed in 3D</span>
                      ) : p.missing.length ? (
                        <span className="field__error">{p.missing.map((m) => MISSING_LABELS[m] ?? m).join(', ')}</span>
                      ) : (
                        <span className="muted">Nothing</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted">
          Pages without a level are still included; their members are listed as missing data until the page is set up. Set
          a page up from its Level tab, then generate again.
        </p>
      </section>

      <LevelProposalsCard projectId={projectId} canEdit={canEdit} />

      {current && (
        <RevisionSection
          key={current.id}
          projectId={projectId}
          current={current}
          revisions={revisions.data}
          canEdit={canEdit}
          linkedMember={linkedMember}
          openTab={openTab}
          datasetId={project.data.section_dataset?.id ?? null}
          onChoose={setChosen}
        />
      )}
    </>
  )
}

const VIEWS: { id: CameraView; label: string }[] = [
  { id: '3d', label: '3D' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
]

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}

function RevisionSection({
  projectId,
  current,
  revisions,
  canEdit,
  linkedMember,
  openTab,
  datasetId,
  onChoose,
}: {
  projectId: string
  current: Wireframe
  revisions: Wireframe[]
  canEdit: boolean
  linkedMember: string | null
  /** Open on the Column scheduler (the project page's link) or the element list. */
  openTab: 'elements' | 'columns'
  datasetId: string | null
  onChoose: (id: string) => void
}) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [onlyProblems, setOnlyProblems] = useState(false)
  const [showCopies, setShowCopies] = useState(false)
  const [tab, setTab] = useState<'elements' | 'columns'>(openTab)
  const tabs = useRef<HTMLDivElement>(null)
  // Opened on the scheduler: bring it into view once the revision is shown.
  useEffect(() => {
    if (openTab === 'columns') tabs.current?.scrollIntoView?.({ block: 'start' })
  }, [openTab])
  // Columns picked in the schedule or in the view (Ctrl+click): one selection for both.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [allHeights, setAllHeights] = useState(false)
  // What a left-drag does in the view, 3D or simple: one switch for both.
  const [dragMode, setDragMode] = useState<'turn' | 'move'>('turn')
  // Bumped when a column's values change in its panel: the panel re-reads the element.
  const [panelNonce, setPanelNonce] = useState(0)
  const [view, setView] = useState<{ id: CameraView; nonce: number }>({ id: '3d', nonce: 0 })
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const [webgl] = useState(supportsWebGL)
  const [expanded, setExpanded] = useFullWindow()
  const generated = current.status === 'draft' || current.status === 'reviewed'
  const elements = useQuery({
    queryKey: ['wireframe', current.id, 'elements'],
    queryFn: () => listWireframeElements(current.id),
    enabled: generated,
  })
  const editable = canEdit && current.status === 'draft' && current.is_latest
  const columnRows = useQuery({
    queryKey: ['wireframe', current.id, 'columns'],
    queryFn: () => getSchedulerColumns(current.id),
    enabled: generated,
  })
  const columnById = useMemo(() => new Map((columnRows.data?.columns ?? []).map((r) => [r.id, r])), [columnRows.data])
  const pick = (id: string | null, additive = false) => {
    if (!id) {
      setSelectedId(null)
      setPicked(new Set())
    } else if (additive) {
      const next = new Set(picked)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setPicked(next)
    } else {
      setSelectedId(id)
      setPicked(new Set([id]))
    }
  }
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['wireframe', current.id, 'elements'] })
    void queryClient.invalidateQueries({ queryKey: ['wireframe', current.id, 'columns'] })
    void queryClient.invalidateQueries({ queryKey: ['wireframes', projectId] })
  }
  const copy = useMutation({
    mutationFn: () => copyWireframe(current.id),
    meta: { successMessage: 'New draft revision started' },
    onSuccess: (w) => {
      onChoose(w.id)
      void queryClient.invalidateQueries({ queryKey: ['wireframes', projectId] })
    },
  })

  // Opened from the plan (?member=…): select that member's element.
  const [linked, setLinked] = useState(false)
  if (!linked && linkedMember && elements.data) {
    setLinked(true)
    const match = elements.data.find((e) => e.source_member === linkedMember)
    if (match) setSelectedId(match.id)
  }

  const all = elements.data ?? []
  const copies = all.filter(isCopy).length
  const shown = all.filter(
    (e) => (showCopies || !isCopy(e)) && (!onlyProblems || (e.completeness !== 'ok' && !isCopy(e))),
  )
  const selected = all.find((e) => e.id === selectedId) ?? null
  const counts = current.counts as
    | {
        elements: number
        by_type: Record<string, number>
        by_completeness: Record<string, number>
        edited: number
        added: number
        removed: number
        columns_without_size: number
        same_column?: number
      }
    | undefined
  const summary = current.summary as { levels?: { label: string; elevation_mm: string }[] }
  const remaining = current.remaining_work as { not_placed?: number; unsupported?: number; columns_without_size?: number }

  return (
    <section className="card" aria-labelledby="wf-revision">
      <div className="card__header">
        <h2 id="wf-revision">
          Revision {current.revision_no} <StatusBadge {...(STATUS[current.status] ?? STATUS.draft!)} />{' '}
          {isDraftBuild(current) && <StatusBadge tone="warning" label="Draft — all run pages" />}
        </h2>
        {revisions.length > 1 && (
          <SelectField
            label="Revision"
            value={current.id}
            onChange={(e) => onChoose(e.target.value)}
            options={revisions.map((w) => ({
              value: w.id,
              label: `Revision ${w.revision_no} · ${STATUS[w.status]?.label ?? w.status}${isDraftBuild(w) ? ' · all run pages' : ''} · ${new Date(w.created_at).toLocaleString()}`,
            }))}
          />
        )}
      </div>
      {current.changes_since && <OutOfDateNotice changes={current.changes_since} />}
      <p className="muted">
        {current.copied_from_revision ? `Started from revision ${current.copied_from_revision}` : 'Generated'} by{' '}
        {current.created_by} on {new Date(current.created_at).toLocaleString()}.
        {current.status === 'reviewed' &&
          ` Saved as reviewed by ${current.reviewed_by} on ${new Date(current.reviewed_at!).toLocaleString()}.`}
      </p>
      {current.status === 'generating' && <LoadingState label="Generating the wireframe…" />}
      {current.status === 'failed' && <p className="field__error">{current.error_message}</p>}
      {current.status === 'reviewed' && (
        <p className="notice notice--compact" role="status">
          Saved as reviewed and frozen. Remaining manual work: {remaining.not_placed ?? 0} not placed,{' '}
          {remaining.unsupported ?? 0} not in 3D, {remaining.columns_without_size ?? 0} columns without a size.
        </p>
      )}
      {generated && counts && (
        <>
          <dl className="abm-stats" aria-label="Wireframe summary">
            {(
              [
                ['Elements', counts.elements],
                ['Beams', counts.by_type.beam ?? 0],
                ['Columns', counts.by_type.column ?? 0],
                ['Placed', counts.by_completeness.ok ?? 0],
                ['Missing data', counts.by_completeness.missing_data ?? 0],
                ['Not in 3D', (counts.by_completeness.unsupported ?? 0) - (counts.same_column ?? 0)],
                ...((counts.same_column ?? 0) > 0 ? [['Same column, other plan', counts.same_column ?? 0]] : []),
                ['Edited', counts.edited],
                ['Added', counts.added],
                ['Removed', counts.removed],
              ] as [string, number][]
            ).map(([label, n]) => (
              <div key={label} data-attention={label === 'Missing data' && n > 0 ? true : undefined}>
                <dt>{label}</dt>
                <dd>{n}</dd>
              </div>
            ))}
          </dl>
          {summary.levels && summary.levels.length > 0 && (
            <p className="muted">
              Levels: {summary.levels.map((l) => `${l.label || 'unnamed'} at ${signedFeetInches(l.elevation_mm)}`).join(' · ')}
            </p>
          )}
          {(counts.by_type.column ?? 0) === 0 && (
            <p className="muted">
              No columns: no column symbols (a drawn “I”, square or circle on a member line) were found on these plans, and no member’s type is set to
              “Column”. Set a member’s type to Column (or add one at its location) and generate again.
            </p>
          )}

          <div className="button-row button-row--tight wf-actions">
            {editable && (
              <>
                <Button
                  onClick={() => {
                    setSelectedId(null)
                    setAdding(true)
                  }}
                >
                  + Add element
                </Button>
                <Button variant="primary" onClick={() => setReviewing(true)}>
                  Save as reviewed…
                </Button>
              </>
            )}
            {canEdit && !editable && current.is_latest && (
              <Button loading={copy.isPending} onClick={() => copy.mutate()}>
                Copy to a new revision
              </Button>
            )}
            {!current.is_latest && <span className="muted">Only the latest revision can be edited.</span>}
          </div>

          <div className="wf3d" data-expanded={expanded ? '' : undefined}>
            <div className="wf3d__stage">
              <Button className="wf3d__expand" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Exit full screen' : 'Full screen'}
              </Button>
              {elements.data && elements.data.some((e) => e.start) && (
                <div className="family-tabs wf3d__views" role="group" aria-label="View">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={view.id === v.id}
                      onClick={() => {
                        setView((s) => ({ id: v.id, nonce: s.nonce + 1 }))
                        setDragMode(v.id === '3d' ? 'turn' : 'move') // a flat view is moved, not turned
                      }}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
              {elements.data && elements.data.some((e) => e.start) && (
                <div className="family-tabs wf3d__mode" role="group" aria-label="Drag to">
                  <button type="button" aria-pressed={dragMode === 'turn'} onClick={() => setDragMode('turn')} title="Left-drag rotates the model (right-drag moves it)">
                    Rotate
                  </button>
                  <button type="button" aria-pressed={dragMode === 'move'} onClick={() => setDragMode('move')} title="Left-drag moves the model (right-drag rotates it)">
                    Move
                  </button>
                </div>
              )}
              {elements.data &&
                (webgl ? (
                  <Suspense fallback={<LoadingState label="Starting the 3D view…" />}>
                    <Wireframe3D
                      elements={elements.data}
                      selectedId={selectedId}
                      marked={picked}
                      columns={columnById}
                      allHeights={allHeights}
                      view={view.id}
                      viewNonce={view.nonce}
                      dragMode={dragMode}
                      onSelect={pick}
                    />
                  </Suspense>
                ) : (
                  <IsometricPreview
                    elements={elements.data}
                    selectedId={selectedId}
                    marked={picked}
                    labels={columnById}
                    allHeights={allHeights}
                    view={view.id}
                    viewNonce={view.nonce}
                    dragMode={dragMode}
                    onSelect={pick}
                  />
                ))}
              <ul className="legend wf3d__legend" aria-label="Wireframe legend">
                <li><span className="wf3d__key wf3d__key--beam" aria-hidden="true" /> Beam</li>
                <li><span className="wf3d__key wf3d__key--column" aria-hidden="true" /> Column</li>
                <li><span className="wf3d__key wf3d__key--added" aria-hidden="true" /> Added by hand</li>
                <li><span className="wf3d__key wf3d__key--selected" aria-hidden="true" /> Selected</li>
                <li><span className="wf3d__dot wf3d__dot--bottom" aria-hidden="true" /> Column bottom</li>
                <li><span className="wf3d__dot wf3d__dot--top" aria-hidden="true" /> Column top</li>
                <li>
                  <label className="checkbox">
                    <input type="checkbox" checked={allHeights} onChange={(e) => setAllHeights(e.target.checked)} /> Show every column’s height
                  </label>
                </li>
              </ul>
              <p className="muted wf3d__help">
                Drag to rotate or move (the switch above) · right-drag does the other · wheel to zoom · click an element to select it (Ctrl+click to pick several).
                {!webgl && (
                  <>
                    {' '}
                    <strong>Simple view:</strong> this browser has 3D graphics (WebGL) turned off, so the model is drawn without it. For the full 3D view,
                    turn on “Use graphics acceleration when available” in Chrome’s settings (System) and restart Chrome.
                  </>
                )}
              </p>
            </div>
            {(adding || selected) && (
              <div className="wf3d__panel">
                {adding ? (
                  <AddElementForm
                    wireframeId={current.id}
                    onAdded={(e) => {
                      setAdding(false)
                      refresh()
                      setSelectedId(e.id)
                    }}
                    onCancel={() => setAdding(false)}
                  />
                ) : (
                  selected && (
                    <ElementPanel
                      key={`${selected.id}:${panelNonce}`}
                      projectId={projectId}
                      element={selected}
                      editable={editable}
                      column={
                        columnById.get(selected.id) && columnRows.data
                          ? { wireframeId: current.id, row: columnById.get(selected.id)!, levels: columnRows.data.levels }
                          : null
                      }
                      onChanged={(updated, keep) => {
                        if (updated) {
                          queryClient.setQueryData<WireframeElement[]>(['wireframe', current.id, 'elements'], (list) =>
                            list?.map((e) => (e.id === updated.id ? updated : e)),
                          )
                        } else if (keep) {
                          // Re-open the panel on the element as it now is (its new version).
                          void queryClient
                            .refetchQueries({ queryKey: ['wireframe', current.id, 'elements'] })
                            .then(() => setPanelNonce((n) => n + 1))
                        } else setSelectedId(null)
                        refresh()
                      }}
                      onStale={refresh}
                      onClose={() => setSelectedId(null)}
                    />
                  )
                )}
              </div>
            )}
          </div>

          <div className="family-tabs wf-tabs" role="group" aria-label="Table" ref={tabs}>
            <button type="button" aria-pressed={tab === 'elements'} onClick={() => setTab('elements')}>
              Elements
            </button>
            <button type="button" aria-pressed={tab === 'columns'} onClick={() => setTab('columns')}>
              Column scheduler
            </button>
          </div>
          {tab === 'columns' ? (
            <ColumnScheduler
              projectId={projectId}
              wireframeId={current.id}
              revisionNo={current.revision_no}
              datasetId={datasetId}
              editable={editable}
              selectedId={selectedId}
              selection={picked}
              onSelectionChange={setPicked}
              onSelect={setSelectedId}
              onChanged={refresh}
            />
          ) : (
            <>
              <div className="button-row button-row--tight">
                <label className="checkbox">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Only
                  elements that are not placed
                </label>
                {copies > 0 && (
                  <label className="checkbox" title="A column shown on two plans of one storey (a foundation plan and the plan above) is drawn and counted once; its copies are kept here for the record">
                    <input type="checkbox" checked={showCopies} onChange={(e) => setShowCopies(e.target.checked)} /> Show columns
                    drawn on another plan ({copies})
                  </label>
                )}
              </div>
              {elements.isPending && <LoadingState label="Loading elements…" />}
              {shown.length > 0 && <ElementTable projectId={projectId} elements={shown} selectedId={selectedId} onSelect={setSelectedId} />}
            </>
          )}
          {reviewing && (
            <ReviewDialog
              wireframe={current}
              counts={counts}
              onClose={() => setReviewing(false)}
              onDone={() => {
                setReviewing(false)
                refresh()
              }}
            />
          )}
        </>
      )}
    </section>
  )
}

function ReviewDialog({
  wireframe,
  counts,
  onClose,
  onDone,
}: {
  wireframe: Wireframe
  counts: { by_completeness: Record<string, number>; columns_without_size: number; same_column?: number }
  onClose: () => void
  onDone: () => void
}) {
  const [note, setNote] = useState('')
  const review = useMutation({
    mutationFn: () => markWireframeReviewed(wireframe.id, note),
    meta: { successMessage: `Revision ${wireframe.revision_no} saved as reviewed` },
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={`Save revision ${wireframe.revision_no} as reviewed?`}>
      <p>The revision is frozen and becomes the one included when the project is finalised. Manual work still to do:</p>
      <ul className="finalize__list">
        <li>{counts.by_completeness.missing_data ?? 0} elements not placed</li>
        <li>{(counts.by_completeness.unsupported ?? 0) - (counts.same_column ?? 0)} elements not in 3D</li>
        <li>{counts.columns_without_size} columns without a size</li>
      </ul>
      <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      {review.error && <p className="field__error">{toApiError(review.error).message}</p>}
      <div className="button-row">
        <Button variant="primary" loading={review.isPending} onClick={() => review.mutate()}>
          Save as reviewed
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  )
}

function ElementTable({
  projectId,
  elements,
  selectedId,
  onSelect,
}: {
  projectId: string
  elements: WireframeElement[]
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <div className="table-wrap wf-elements">
      <table className="table table--compact quantities">
        <caption className="visually-hidden">Wireframe elements</caption>
        <thead>
          <tr>
            <th scope="col">Type</th>
            <th scope="col">Section</th>
            <th scope="col">Level</th>
            <th scope="col">Length</th>
            <th scope="col">Start (x, y, z)</th>
            <th scope="col">End (x, y, z)</th>
            <th scope="col">Status</th>
            <th scope="col">Notes</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {elements.map((e) => (
            <tr key={e.id} data-selected={e.id === selectedId || undefined} onClick={() => onSelect(e.id)}>
              <td>{e.element_type === 'column' ? 'Column' : 'Beam'}</td>
              <td>
                {e.designation || (e.details.source === 'symbol' ? <span className="muted">Size not on plan</span> : '—')}
              </td>
              <td>{e.level_label || <span className="muted">—</span>}</td>
              <td className="nowrap">{e.length_display || '—'}</td>
              <td className="nowrap">{point(e.start)}</td>
              <td className="nowrap">{point(e.end)}</td>
              <td className="nowrap">
                <StatusBadge {...(isCopy(e) ? { label: 'Other plan', tone: 'neutral' as StatusTone } : (COMPLETENESS[e.completeness] ?? COMPLETENESS.ok!))} />
              </td>
              <td className="wf-elements__notes">
                {e.issue_messages.join(' ')}
                {e.details.source === 'symbol' &&
                  ` ${describeColumn({ shape: (e.details.shape as string) ?? 'wide_flange', depth_in: Number(e.details.depth_in), flange_in: Number(e.details.flange_in) })}.`}
              </td>
              <td className="nowrap">
                {e.source_page && (
                  <Link to={`/projects/${projectId}/pages/${e.source_page}${e.source_member ? `?member=${e.source_member}` : ''}`}>
                    p.{e.page_number}
                  </Link>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type ChangesSince = NonNullable<Wireframe['changes_since']>

function pageNames(pages: ChangesSince['pages_added']) {
  return pages.map((p) => `page ${p.page_number} · ${p.original_filename}`).join(', ')
}

/** The latest revision was generated before these page changes: say so, and what to do. */
function OutOfDateNotice({ changes }: { changes: ChangesSince }) {
  const { pages_added: added, pages_removed: removed, set_up_changed: changed } = changes
  if (!added.length && !removed.length && !changed.length) return null
  const plural = (n: number) => (n === 1 ? '1 page' : `${n} pages`)
  return (
    <div className="notice notice--warning" role="note" aria-label="Wireframe out of date">
      <p>
        <strong>This wireframe is out of date.</strong> Since it was generated:
      </p>
      <ul>
        {added.length > 0 && (
          <li>
            {plural(added.length)} added to the project ({pageNames(added)})
          </li>
        )}
        {changed.length > 0 && (
          <li>
            level set-up changed on {plural(changed.length)} ({pageNames(changed)})
          </li>
        )}
        {removed.length > 0 && (
          <li>
            {plural(removed.length)} no longer in the project ({pageNames(removed)})
          </li>
        )}
      </ul>
      <p>Choose Generate again at the top of the page to include these changes.</p>
    </div>
  )
}

/** The 3D view filling the window (Esc leaves it). Not the browser's full-screen mode: its
 * dialogs (remove an element, …) open on the page and would be hidden behind it. */
function useFullWindow(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(false)
  useEffect(() => {
    if (!on) return
    const scroll = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      // A dialog open over the view takes its own Escape.
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"], [role="alertdialog"]')) setOn(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = scroll
      document.removeEventListener('keydown', onKey)
    }
  }, [on])
  return [on, setOn]
}

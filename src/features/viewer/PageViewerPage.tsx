import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { fetchOriginalPdf, getDrawingSet, getPage, listPages } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import { findSimilarColumns, type FindSimilarResult } from '../../api/processing'
import { listPageIssues, listPageMembers } from '../../api/members'
import { getProject } from '../../api/projects'
import type { DrawingPageListItem } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { isActiveJob, PAGE_STATUS } from '../drawings/status'
import { ProjectLockedNotice } from '../finalize/ProjectLockedNotice'
import { projectCan } from '../projects/useProjectPermissions'
import { AddMemberForm } from '../review/AddMemberForm'
import { MemberEditor } from '../review/MemberEditor'
import { ReviewBar } from '../review/ReviewBar'
import { useMemberCache } from '../review/useMemberCache'
import { DrawingStage, type FocusRequest } from './DrawingStage'
import { columnBreakdown } from './columnSymbols'
import { nearestGridPoint } from './grids'
import { memberKind, MEMBER_KINDS, type MemberKind } from './memberAppearance'
import { PageStrip } from './PageStrip'
import { FlagsPanel } from './panels/FlagsPanel'
import { LevelPanel } from './panels/LevelPanel'
import { PagePanel } from './panels/PagePanel'
import { QuantitiesPanel } from './panels/QuantitiesPanel'
import { ScalePanel } from './panels/ScalePanel'
import { loadPdf } from './pdf'
import { ViewerRail, type ViewerTab } from './ViewerRail'

const POLL_MS = 2000
const ALL = 'ALL'

export function PageViewerPage() {
  const { projectId = '', pageId = '' } = useParams()
  const navigate = useNavigate()
  // ?member=<id>: open with that member selected and in view (links from the ABM).
  const [searchParams] = useSearchParams()
  const linkedMember = searchParams.get('member')
  const [download, setDownload] = useState<{ loaded: number; total?: number } | null>(null)

  // Workspace state: shared by the drawing, the panels and the toolbar.
  const [tab, setTab] = useState<ViewerTab>(() => (searchParams.get('tab') === 'level' ? 'level' : 'quantities'))
  const [panelOpen, setPanelOpen] = useState(true)
  const [stripOpen, setStripOpen] = useState(true)
  const [family, setFamily] = useState<string>(ALL)
  const [showLabels, setShowLabels] = useState(true)
  const [showGrids, setShowGrids] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(linkedMember)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(() => (linkedMember ? { memberId: linkedMember, nonce: 1 } : null))
  // Adding a missed member: null = not adding; location null = not picked yet.
  const [adding, setAdding] = useState<{ location: [number, number] | null } | null>(null)
  const [placing, setPlacing] = useState(false)
  // Picking the reference grid point (Level panel) uses the same click-on-drawing mode.
  const [pickingReference, setPickingReference] = useState(false)
  const [pickedReference, setPickedReference] = useState<[number, number] | null>(null)
  // The grid intersection the picked point snapped to (its label fills in the Level form).
  const [pickedLabel, setPickedLabel] = useState<string | null>(null)
  // Find similar: a click on a column symbol Steelo missed; its likes become columns.
  const [findingSimilar, setFindingSimilar] = useState(false)
  const [similarFound, setSimilar] = useState<{ pageId: string; point: [number, number]; result: FindSimilarResult; scope: 'page' | 'set' } | null>(null)
  const similar = similarFound?.pageId === pageId ? similarFound : null  // shown on its own page only
  const queryClient = useQueryClient()

  const project = useQuery({ queryKey: ['project', projectId], queryFn: () => getProject(projectId) })
  const page = useQuery({
    queryKey: ['drawing-page', pageId],
    queryFn: () => getPage(pageId),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (isActiveJob(q.state.data?.latest_job) ? POLL_MS : false),
  })
  const setId = page.data?.drawing_set
  const drawingSet = useQuery({ queryKey: ['drawing-set', setId], queryFn: () => getDrawingSet(setId!), enabled: Boolean(setId) })
  const siblings = useQuery({
    queryKey: ['drawing-set', setId, 'pages', 'viewer'],
    queryFn: () => listPages(setId!),
    enabled: Boolean(setId),
    staleTime: 30_000,
    // Thumbnails keep their status current while any page is being processed.
    refetchInterval: (q) => (q.state.data?.some((p) => isActiveJob(p.latest_job)) ? POLL_MS : false),
  })
  // A run started or finished elsewhere (another tab, the drawing set page) shows up in the
  // page strip first: bring this page's own data up to date so its header agrees.
  const stripJob = siblings.data?.find((p) => p.id === pageId)?.latest_job
  const pageJob = page.data?.id === pageId ? page.data.latest_job : undefined
  const { refetch: refetchPage } = page
  useEffect(() => {
    if (stripJob && pageJob && (stripJob.id !== pageJob.id || stripJob.status !== pageJob.status)) void refetchPage()
  }, [stripJob, pageJob, refetchPage])
  const pdf = useQuery({
    queryKey: ['drawing-set', setId, 'pdf'],
    queryFn: async () => loadPdf(await fetchOriginalPdf(setId!, (loaded, total) => setDownload({ loaded, total }))),
    enabled: Boolean(setId), // in parallel with the page strip: the PDF is the longest request
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  })

  // This page's own detail: not the previous page's, kept as placeholder while switching. The
  // only source of overlay and panel data (columns, grids, grid points, summary, scale check,
  // grid spacings): the page list's runs will not carry them (backend Step B).
  const detail = page.data?.id === pageId && !page.isPlaceholderData ? page.data : undefined
  const current: DrawingPageListItem | undefined = detail ?? siblings.data?.find((p) => p.id === pageId)
  /** The run with its overlay and panel data: null = no run, undefined = the detail is loading. */
  const detailRun = detail ? detail.current_run : undefined
  const runLoading = !detail && Boolean(current?.current_run)
  const runId = current?.current_run?.id
  const members = useQuery({
    queryKey: ['drawing-page', pageId, 'members', runId],
    queryFn: () => listPageMembers(pageId),
    enabled: Boolean(runId),
  })
  const issues = useQuery({
    queryKey: ['drawing-page', pageId, 'issues', runId],
    queryFn: () => listPageIssues(pageId),
    enabled: Boolean(runId),
  })

  const allMembers = useMemo(() => (runId ? (members.data ?? []) : []), [members.data, runId])
  const families = useMemo(() => {
    const counts = new Map<string, number>()
    for (const m of allMembers) counts.set(m.profile, (counts.get(m.profile) ?? 0) + m.quantity)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [allMembers])
  const activeFamily = family !== ALL && families.some(([f]) => f === family) ? family : ALL
  const shown = useMemo(
    () => (activeFamily === ALL ? allMembers : allMembers.filter((m) => m.profile === activeFamily)),
    [allMembers, activeFamily],
  )
  const kindsPresent = useMemo(() => [...new Set(shown.map(memberKind))] as MemberKind[], [shown])
  const lowCount = useMemo(() => shown.filter((m) => memberKind(m) === 'low').length, [shown])
  const gridPoints = detailRun?.grid_points
  const cache = useMemberCache(pageId, runId)
  const selected = allMembers.find((m) => m.id === selectedId) ?? null
  const cancelPlace = useCallback(() => {
    setPlacing(false)
    setPickingReference(false)
    setFindingSimilar(false)
  }, [])
  const findSimilar = useMutation({
    mutationFn: ({ point, scope }: { point: [number, number]; scope: 'page' | 'set' }) => findSimilarColumns(pageId, point, scope),
    onSuccess: (result, { point, scope }) => {
      setSimilar({ pageId, point, result, scope })
      // The page's columns, its members (new ABM entries) and the set's pages all change.
      // The set's PDF does not: invalidating it would download and parse the drawing again.
      void queryClient.invalidateQueries({ queryKey: ['drawing-page'] })
      void queryClient.invalidateQueries({ queryKey: ['drawing-set', setId], predicate: (q) => q.queryKey[2] !== 'pdf' })
      void cache.refetch()
    },
  })
  const place = useCallback(
    (location: [number, number]) => {
      setPlacing(false)
      if (findingSimilar) {
        setFindingSimilar(false)
        setSimilar(null)
        findSimilar.mutate({ point: location, scope: 'page' })
        return
      }
      if (pickingReference) {
        setPickingReference(false)
        const snapped = nearestGridPoint(gridPoints, location)
        setPickedReference(snapped ? [snapped.x, snapped.y] : location)
        setPickedLabel(snapped?.label ?? null)
        setTab('level')
        setPanelOpen(true)
        return
      }
      setAdding({ location })
      setTab('quantities')
      setPanelOpen(true)
    },
    [pickingReference, gridPoints, findingSimilar, findSimilar],
  )

  // Selecting in the list zooms the drawing to the member; selecting on the drawing opens
  // the Quantities list at that row.
  const selectFromList = useCallback((id: string) => {
    setSelectedId(id)
    setFocus((f) => ({ memberId: id, nonce: (f?.nonce ?? 0) + 1 }))
  }, [])
  const selectFromDrawing = useCallback((id: string | null) => {
    setSelectedId(id)
    if (id) {
      setTab('quantities')
      setPanelOpen(true)
    }
  }, [])
  const showMember = useCallback(
    (id: string) => {
      setFamily(ALL)
      selectFromList(id)
    },
    [selectFromList],
  )

  const error = project.error ?? (page.isPlaceholderData ? null : page.error) ?? drawingSet.error
  if (error) {
    const notFound = toApiError(error).status === 404
    return notFound ? (
      <div className="state state--empty">
        <h1 className="state__title">Page not found</h1>
        <p>It does not exist, was removed, or you are not a member of this project.</p>
        <Link to={`/projects/${projectId}`}>Back to the project</Link>
      </div>
    ) : (
      <ErrorState title="Could not open the page" error={error} />
    )
  }
  if (!project.data || !drawingSet.data || !current) return <LoadingState label="Opening page…" />

  const pages = siblings.data ?? []
  const index = pages.findIndex((p) => p.id === pageId)
  const prev = index > 0 ? pages[index - 1] : undefined
  const next = index >= 0 && index < pages.length - 1 ? pages[index + 1] : undefined
  const go = (id: string) => {
    setSelectedId(null)
    setHoveredId(null)
    setAdding(null)
    setPlacing(false)
    setPickingReference(false)
    setPickedReference(null)
    setPickedLabel(null)
    navigate(`/projects/${projectId}/pages/${id}`)
  }
  const status = PAGE_STATUS[current.status]
  const canRun = projectCan(project.data, 'project.edit')
  const finalised = project.data?.status === 'finalized'
  // Pages added to the project stay editable: their members are ABM entries (OD-31).
  const reviewLocked = current.status === 'reviewed'
  const canAdd = canRun && (current.status === 'processed' || current.status === 'added')

  const onTab = (nextTab: ViewerTab) => {
    if (panelOpen && nextTab === tab) setPanelOpen(false)
    else {
      setTab(nextTab)
      setPanelOpen(true)
    }
  }

  return (
    <div className="viewer workspace" data-panel={panelOpen ? 'open' : 'closed'} data-strip={stripOpen ? 'open' : 'closed'}>
      <header className="workspace__header">
        <div>
          <nav aria-label="Breadcrumb" className="breadcrumb">
            <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/projects/${projectId}`}>{project.data.name}</Link> <span aria-hidden="true">/</span>{' '}
            <span>{drawingSet.data.original_filename}</span>
          </nav>
          <h1 className="viewer__title">
            Page {current.page_number} <span className="muted">of {drawingSet.data.page_count}</span>{' '}
            <StatusBadge tone={status.tone} label={status.label} />
            {current.current_run?.engine_outdated && (
              <button
                type="button"
                className="status-badge status-badge--warning viewer__outdated"
                title={`Read with Steelo ${current.current_run.engine_version}; now ${current.current_run.current_engine_version ?? 'newer'}. Run again to read it with the latest rules.`}
                onClick={() => {
                  setTab('page')
                  setPanelOpen(true)
                }}
              >
                Older version · run again
              </button>
            )}
          </h1>
        </div>
        <div className="workspace__nav" role="toolbar" aria-label="Page navigation">
          <Button disabled={!prev} onClick={() => prev && go(prev.id)}>
            ← Previous
          </Button>
          <Button disabled={!next} onClick={() => next && go(next.id)}>
            Next →
          </Button>
          <Button aria-pressed={stripOpen} onClick={() => setStripOpen((o) => !o)}>
            Pages
          </Button>
          <Link className="button button--secondary" to={`/projects/${projectId}/abm`}>
            ABM
          </Link>
        </div>
      </header>

      <ViewerRail
        active={tab}
        open={panelOpen}
        counts={{ quantities: allMembers.length, flags: issues.data?.length }}
        onChange={onTab}
      />

      {panelOpen && (
        <aside id="viewer-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="workspace__panel">
          {tab === 'quantities' && (
            <QuantitiesPanel
              members={shown}
              loading={Boolean(runId) && members.isPending}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectFromList}
              onHover={setHoveredId}
              onAdd={
                canAdd && !adding
                  ? () => {
                      setSelectedId(null)
                      setAdding({ location: null })
                      setPlacing(true)
                    }
                  : undefined
              }
            >
              {current.current_run && (
                <ReviewBar projectId={projectId} page={current} members={allMembers} canEdit={canRun} onChanged={() => void cache.refetch()} />
              )}
              {adding && (
                <AddMemberForm
                  pageId={pageId}
                  location={adding.location}
                  onPickLocation={() => setPlacing(true)}
                  onAdded={(member) => {
                    cache.append(member)
                    setAdding(null)
                    setFamily(ALL)
                    selectFromList(member.id)
                  }}
                  onCancel={() => {
                    setAdding(null)
                    setPlacing(false)
                  }}
                />
              )}
              {selected && !adding && (
                <MemberEditor
                  key={selected.id}
                  member={selected}
                  index={allMembers.indexOf(selected) + 1}
                  canEdit={canRun}
                  locked={reviewLocked}
                  onSaved={cache.replace}
                  onStale={() => void cache.refetch()}
                  onClose={() => setSelectedId(null)}
                />
              )}
              {selected && !adding && current.status === 'added' && selected.review_status !== 'rejected' && (
                <p className="button-row button-row--tight">
                  <Link to={`/projects/${projectId}/abm?member=${selected.id}`}>Show in ABM</Link>
                  <Link to={`/projects/${projectId}/wireframe?member=${selected.id}`}>Show in 3D</Link>
                </p>
              )}
            </QuantitiesPanel>
          )}
          {tab === 'flags' && (
            <FlagsPanel
              issues={issues.data ?? []}
              members={allMembers}
              loading={Boolean(runId) && issues.isPending}
              onShowMember={showMember}
            />
          )}
          {tab === 'scale' && <ScalePanel run={current.current_run ? detailRun : null} />}
          {tab === 'level' && (
            <LevelPanel
              key={current.id}
              projectId={projectId}
              page={current}
              canEdit={canRun}
              picked={pickedReference}
              pickedLabel={pickedLabel}
              gridPoints={gridPoints}
              gridPointsLoading={runLoading}
              onPick={() => {
                setAdding(null)
                setPickingReference(true)
                setPlacing(true)
              }}
              onChoose={(point) => {
                setPickedReference([point.x, point.y])
                setPickedLabel(point.label)
              }}
              onPickedSaved={() => {
                setPickedReference(null)
                setPickedLabel(null)
              }}
            />
          )}
          {tab === 'page' && (
            <>
              {finalised && project.data && <ProjectLockedNotice project={project.data} />}
              <PagePanel key={current.id} page={current} run={current.current_run ? detailRun : null} canRun={canRun} />
            </>
          )}
        </aside>
      )}

      <div className="workspace__stage">
        <DrawingStage
          widthPt={current.width_pt ?? 0}
          heightPt={current.height_pt ?? 0}
          rotation={current.rotation}
          pdfState={pdf}
          download={download}
          pageNumber={current.page_number}
          label={`Drawing: page ${current.page_number} of ${drawingSet.data.original_filename}`}
          members={shown}
          showLabels={showLabels}
          selectedId={selectedId}
          hoveredId={hoveredId}
          focus={focus}
          onSelect={selectFromDrawing}
          onHover={setHoveredId}
          placing={placing}
          placingHint={
            findingSimilar
              ? 'Click on a column symbol Steelo missed: every mark drawn like it becomes a column'
              : pickingReference
              ? gridPoints?.length
                ? 'Click near the reference grid intersection (it snaps to the nearest one)'
                : 'Click the reference grid intersection'
              : undefined
          }
          columns={detailRun?.columns ?? undefined}
          grids={detailRun?.grids ?? undefined}
          showGrids={showGrids}
          onPlace={place}
          onCancelPlace={cancelPlace}
          marker={
            pickedReference || current.reference_point
              ? {
                  point: (pickedReference ?? current.reference_point) as [number, number],
                  label: (pickedReference ? pickedLabel : null) || current.reference_label || 'Reference',
                }
              : null
          }
          toolbar={
            <>
              {families.length > 0 && (
                <div className="family-tabs" role="group" aria-label="Show section types">
                  <button type="button" aria-pressed={activeFamily === ALL} onClick={() => setFamily(ALL)}>
                    All <span className="family-tabs__count">{allMembers.length}</span>
                  </button>
                  {families.map(([f, count]) => (
                    <button key={f} type="button" aria-pressed={activeFamily === f} onClick={() => setFamily(f)}>
                      {f} <span className="family-tabs__count">{count}</span>
                    </button>
                  ))}
                </div>
              )}
              {allMembers.length > 0 && (
                <label className="checkbox">
                  <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
                </label>
              )}
              {canRun && current.current_run && (
                <Button
                  aria-pressed={findingSimilar}
                  loading={findSimilar.isPending}
                  title="Point at a column symbol Steelo missed: every mark drawn like it becomes a column"
                  onClick={() => {
                    if (findingSimilar) return cancelPlace()
                    setAdding(null)
                    setPickingReference(false)
                    setFindingSimilar(true)
                    setPlacing(true)
                  }}
                >
                  Find similar
                </Button>
              )}
              {findSimilar.error && (
                <span className="field__error" role="alert">
                  {toApiError(findSimilar.error).message}
                </span>
              )}
              {similar && (
                <span className="similar-result" role="status">
                  {similar.result.added
                    ? `${similar.result.added} column${similar.result.added === 1 ? '' : 's'} added${
                        similar.scope === 'set' ? ` on ${similar.result.pages.length} page${similar.result.pages.length === 1 ? '' : 's'}` : ' on this page'
                      }.`
                    : similar.scope === 'set'
                      ? 'No more found on the other plans.'
                      : 'No new columns: those found are already columns.'}{' '}
                  {similar.scope === 'page' && (
                    <Button loading={findSimilar.isPending} onClick={() => findSimilar.mutate({ point: similar.point, scope: 'set' })}>
                      Also on every plan of this set
                    </Button>
                  )}
                  <Button aria-label="Dismiss" onClick={() => setSimilar(null)}>
                    ×
                  </Button>
                </span>
              )}
              {runLoading && (
                <span className="muted" role="status">
                  Loading the drawing overlays…
                </span>
              )}
              {Boolean(detailRun?.grids?.length) && (
                <label className="checkbox">
                  <input type="checkbox" checked={showGrids} onChange={(e) => setShowGrids(e.target.checked)} /> Grids (
                  {detailRun!.grids!.filter((g) => !g.secondary).length})
                </label>
              )}
              {showLabels && (kindsPresent.length > 0 || Boolean(detailRun?.columns?.length)) && (
                <ul className="legend" aria-label="Legend">
                  {Boolean(detailRun?.columns?.length) && (
                    <li>
                      <svg width="22" height="12" aria-hidden="true">
                        <rect x="6" y="1" width="10" height="10" className="column-overlay__key" />
                      </svg>
                      <span title={columnBreakdown(detailRun!.columns!)}>Column ({detailRun!.columns!.length})</span>
                    </li>
                  )}
                  {kindsPresent.map((kind) => (
                    <li key={kind}>
                      <svg width="22" height="12" aria-hidden="true">
                        <rect x="1" y="1" width="20" height="10" rx="2" className={`member-shape member-shape--${kind}`} />
                      </svg>
                      {MEMBER_KINDS[kind].label}
                      {kind === 'low' && ` (${lowCount})`}
                    </li>
                  ))}
                </ul>
              )}
            </>
          }
        />
        {!current.current_run && (
          <p className="stage__hint" role="status">
            This page has not been processed yet.{' '}
            {canRun
              ? 'Open Page in the left rail and choose Run Plan.'
              : finalised
                ? 'The project is finalised: reopen it on the project page to run pages.'
                : ''}
          </p>
        )}
      </div>

      {stripOpen && (
        <aside className="workspace__strip">
          <PageStrip pages={pages} currentId={pageId} setName={drawingSet.data.original_filename} onOpen={go} />
        </aside>
      )}
    </div>
  )
}

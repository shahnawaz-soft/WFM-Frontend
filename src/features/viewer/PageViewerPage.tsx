import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'

import { fetchOriginalPdf, getDrawingSet, getPage, listPages } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import {
  findSimilarColumns,
  removeColumn,
  removeInBox,
  removeLike,
  undoRemoveInBox,
  type FindSimilarResult,
  type RemovedInBox,
} from '../../api/processing'
import { listPageIssues, listPageMembers } from '../../api/members'
import { getProject } from '../../api/projects'
import type { ColumnSymbol, DrawingPageListItem } from '../../api/types'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { isActiveJob, PAGE_STATUS } from '../drawings/status'
import { groupLabel, kindGroup, tabFromParam } from '../drawings/sheets'
import { usePagePreview } from './usePagePreview'
import { ProjectLockedNotice } from '../finalize/ProjectLockedNotice'
import { PickedPenDialog } from '../projects/ProjectPens'
import { projectCan } from '../projects/useProjectPermissions'
import { AddMemberForm } from '../review/AddMemberForm'
import { BulkReviewBar } from '../review/BulkReviewBar'
import { MemberEditor } from '../review/MemberEditor'
import { ReviewBar } from '../review/ReviewBar'
import { useMemberCache } from '../review/useMemberCache'
import { DrawingStage, type FocusRequest } from './DrawingStage'
import { columnBreakdown } from './columnSymbols'
import { nearestGridPoint } from './grids'
import { memberKind, MEMBER_KINDS, type MemberKind } from './memberAppearance'
import { PageAreaControls, type AreaBox } from './PageAreaControls'
import { PageStrip } from './PageStrip'
import { FlagsPanel } from './panels/FlagsPanel'
import { LevelPanel } from './panels/LevelPanel'
import { PagePanel } from './panels/PagePanel'
import { QuantitiesPanel } from './panels/QuantitiesPanel'
import { ScalePanel } from './panels/ScalePanel'
import { SetSimilarSearchStatus } from './SetSimilarSearchStatus'
import { useSetSimilarSearch } from './useSetSimilarSearch'
import { loadPdf } from './pdf'
import { ModelPanel } from './panels/ModelPanel'
import { ViewerRail, type ViewerTab } from './ViewerRail'

const POLL_MS = 2000
const ALL = 'ALL'

export function PageViewerPage() {
  const { projectId = '', pageId = '' } = useParams()
  const navigate = useNavigate()
  // ?member=<id>: open with that member selected and in view (links from the ABM).
  const [searchParams] = useSearchParams()
  const linkedMember = searchParams.get('member')
  // ?sheets=plan: opened from that tab of the project page: the strip and Previous / Next go
  // through that tab's pages only (until "Show all pages").
  const sheets = tabFromParam(searchParams.get('sheets'))
  const [download, setDownload] = useState<{ loaded: number; total?: number } | null>(null)

  // Workspace state: shared by the drawing, the panels and the toolbar.
  const [tab, setTab] = useState<ViewerTab>(() => (searchParams.get('tab') === 'level' ? 'level' : 'quantities'))
  const [panelOpen, setPanelOpen] = useState(true)
  const [stripOpen, setStripOpen] = useState(true)
  // Full drawing: the app menu, the panel and the page strip out of the way (UX review).
  const [full, setFull] = useState(false)
  const [family, setFamily] = useState<string>(ALL)
  const [showLabels, setShowLabels] = useState(true)
  const [showGrids, setShowGrids] = useState(true)
  // Reference lines from printed dimensions: off until a person asks (a plan can have twenty).
  const [showDimensionLines, setShowDimensionLines] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(linkedMember)
  const [editingId, setEditingId] = useState<string | null>(linkedMember)
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
  // Drawing the box of the part of the sheet to count (the page's area).
  const [drawingArea, setDrawingArea] = useState(false)
  const [proposedArea, setProposedArea] = useState<{ area: AreaBox | null } | null>(null)
  // Remove in box: a box dragged round false finds; what is in it, to confirm; the last removed.
  const [boxRemoving, setBoxRemoving] = useState(false)
  const [boxFound, setBoxFound] = useState<{
    box: [number, number, number, number]
    columns: number
    members: number
    take: { columns: boolean; members: boolean }
  } | null>(null)
  const [lastBoxRemoved, setLastBoxRemoved] = useState<{ pageId: string; removed: RemovedInBox } | null>(null)
  // Picking a pen: the next click on the drawing reads the pen of the line there.
  const [pickingPen, setPickingPen] = useState(false)
  const [penPoint, setPenPoint] = useState<[number, number] | null>(null)
  // A column a person is removing (found wrongly), and the last one removed (for Undo).
  const [removingColumn, setRemovingColumn] = useState<ColumnSymbol | null>(null)
  const [lastRemoved, setLastRemoved] = useState<{ pageId: string; points: [number, number][] } | null>(null)
  // "Remove all like this": the columns found drawn like the last one removed, to confirm.
  const [likeFound, setLikeFound] = useState<[number, number][] | null>(null)
  const [similarFound, setSimilar] = useState<{ pageId: string; point: [number, number]; result: FindSimilarResult } | null>(null)
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
  // The page's picture, shown at once while the PDF is drawn; the pages either side fetched ahead.
  const strip = siblings.data ?? []
  const at = strip.findIndex((p) => p.id === pageId)
  const previewUrl = usePagePreview(pageId, at >= 0 ? [strip[at - 1]?.id, strip[at + 1]?.id] : [])

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
    setDrawingArea(false)
    setPickingPen(false)
    setBoxRemoving(false)
  }, [])
  // After Find similar added columns: the pages' columns, their members (new ABM entries) and
  // the set's pages change. The set's PDF does not: invalidating it would download and parse
  // the drawing again.
  const { refetch: refetchMembers } = cache
  const refreshAfterSimilar = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['drawing-page'] })
    void queryClient.invalidateQueries({ queryKey: ['drawing-set', setId], predicate: (q) => q.queryKey[2] !== 'pdf' })
    void refetchMembers()
  }, [queryClient, setId, refetchMembers])
  // This page only: one request.
  const refreshColumns = () => {
    void queryClient.invalidateQueries({ queryKey: ['drawing-page'] })
    void refetchMembers()
  }
  const columnRemoval = useMutation({
    mutationFn: async ({ points, undo }: { points: [number, number][]; undo: boolean }) => {
      for (const point of points) await removeColumn(pageId, point, undo)
    },
    meta: { successMessage: 'Column list updated' },
    onSuccess: (_, { points, undo }) => {
      setRemovingColumn(null)
      setLastRemoved(undo ? null : { pageId, points })
      refreshColumns()
    },
  })
  const boxRemoval = useMutation({
    mutationFn: ({ box, take }: { box: [number, number, number, number]; take: { columns: boolean; members: boolean } }) =>
      removeInBox(pageId, box, take),
    meta: { suppressErrorToast: true },
    onSuccess: (removed) => {
      setBoxFound(null)
      const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
      const kept = removed.kept.length ? `; ${n(removed.kept.length, 'member')} you reviewed or added kept` : ''
      notify.success(`Removed ${n(removed.columns.length, 'column')} and ${n(removed.members.length, 'member')}${kept}.`)
      setLastBoxRemoved(removed.columns.length || removed.members.length ? { pageId, removed } : null)
      refreshColumns()
    },
  })
  const undoBoxRemoval = useMutation({
    mutationFn: (removed: RemovedInBox) => undoRemoveInBox(pageId, removed),
    meta: { successMessage: 'Brought back what the box removed' },
    onSuccess: () => {
      setLastBoxRemoved(null)
      refreshColumns()
    },
  })
  const findLike = useMutation({
    mutationFn: (point: [number, number]) => removeLike(pageId, point, false),
    onSuccess: (result) => setLikeFound(result.columns),
  })
  const removeAllLike = useMutation({
    mutationFn: (point: [number, number]) => removeLike(pageId, point, true),
    onSuccess: () => {
      notify.success(`Removed ${likeFound?.length ?? 0} columns drawn like it`)
      setLastRemoved((last) => (last ? { pageId, points: [...last.points, ...(likeFound ?? [])] } : last))
      setLikeFound(null)
      refreshColumns()
    },
  })
  const findSimilar = useMutation({
    mutationFn: ({ point, box }: { point: [number, number]; box?: [number, number, number, number] }) =>
      findSimilarColumns(pageId, point, box),
    onSuccess: (result, { point }) => {
      setSimilar({ pageId, point, result })
      refreshAfterSimilar()
    },
  })
  // Every plan of the set: a job the viewer follows (and finds again when the person comes back).
  const setSearch = useSetSimilarSearch(pageId, setId, refreshAfterSimilar)
  const place = useCallback(
    (location: [number, number]) => {
      setPlacing(false)
      if (drawingArea || boxRemoving) {
        setDrawingArea(false) // an area is a box: a plain click draws none
        setBoxRemoving(false)
        return
      }
      if (pickingPen) {
        setPickingPen(false)
        setPenPoint(location)
        return
      }
      if (findingSimilar) {
        setFindingSimilar(false)
        setSimilar(null)
        findSimilar.mutate({ point: location })
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
    [pickingReference, gridPoints, findingSimilar, findSimilar, drawingArea, pickingPen, boxRemoving],
  )

  // Selecting in the list zooms the drawing to the member; selecting on the drawing opens
  // the Quantities list at that row.
  const selectFromList = useCallback((id: string) => {
    setSelectedId(id)
    setEditingId((e) => (e === id ? e : null))
    setFocus((f) => ({ memberId: id, nonce: (f?.nonce ?? 0) + 1 }))
  }, [])
  // The edit form opens only from a row's edit button (selecting just shows the member).
  const editFromList = useCallback(
    (id: string) => {
      selectFromList(id)
      setEditingId(id)
    },
    [selectFromList],
  )
  const selectFromDrawing = useCallback((id: string | null) => {
    setSelectedId(id)
    setEditingId((e) => (e === id ? e : null))
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

  // Hidden pages are left out of review (the open page stays, even if it is hidden), and so are
  // pages of other tabs when it was opened from one.
  const pages = (siblings.data ?? []).filter(
    (p) => p.id === pageId || (!p.hidden && (sheets === 'all' || kindGroup(p) === sheets)),
  )
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
    navigate(`/projects/${projectId}/pages/${id}${sheets === 'all' ? '' : `?sheets=${sheets}`}`)
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
    <div
      className="viewer workspace"
      data-panel={panelOpen ? 'open' : 'closed'}
      data-strip={stripOpen ? 'open' : 'closed'}
      data-full={full ? 'on' : 'off'}
    >
      <header className="workspace__header">
        <div>
          <nav aria-label="Breadcrumb" className="breadcrumb">
            <Link to="/projects">Projects</Link> <span aria-hidden="true">/</span>{' '}
            <Link to={`/projects/${projectId}${sheets === 'all' ? '' : `?tab=${sheets}`}`}>{project.data.name}</Link>{' '}
            <span aria-hidden="true">/</span>{' '}
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
        <ViewerRail
          active={tab}
          open={panelOpen}
          counts={{ quantities: allMembers.length, flags: issues.data?.length }}
          onChange={onTab}
        />
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
          <Button
            aria-pressed={full}
            title="Hide the menu, the panel and the page strip to give the drawing the whole window"
            onClick={() => {
              setFull((f) => !f)
              setPanelOpen(full)
              setStripOpen(full)
            }}
          >
            {full ? 'Exit full drawing' : 'Full drawing'}
          </Button>
          <Link className="button button--secondary" to={`/projects/${projectId}/abm`}>
            ABM
          </Link>
          <Link className="button button--secondary" to={`/projects/${projectId}`} aria-label="Close page review">
            <span aria-hidden="true">✕</span> Close
          </Link>
        </div>
      </header>

      {panelOpen && (
        <aside id="viewer-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="workspace__panel">
          {tab === 'quantities' && (
            <QuantitiesPanel
              members={shown}
              loading={Boolean(runId) && members.isPending}
              selectedId={selectedId}
              hoveredId={hoveredId}
              onSelect={selectFromList}
              onEdit={editFromList}
              onHover={setHoveredId}
              bulkActions={
                canRun && !reviewLocked && current.current_run
                  ? (chosen, clear) => (
                      <BulkReviewBar
                        pageId={pageId}
                        chosen={chosen}
                        onSaved={(saved) => saved.forEach(cache.replace)}
                        onStale={() => void cache.refetch()}
                        onClear={clear}
                      />
                    )
                  : undefined
              }
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
                    editFromList(member.id)
                  }}
                  onCancel={() => {
                    setAdding(null)
                    setPlacing(false)
                  }}
                />
              )}
              {selected && editingId === selected.id && !adding && (
                <MemberEditor
                  key={selected.id}
                  member={selected}
                  index={allMembers.indexOf(selected) + 1}
                  canEdit={canRun}
                  locked={reviewLocked}
                  onSaved={cache.replace}
                  onStale={() => void cache.refetch()}
                  onClose={() => setEditingId(null)}
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
          {tab === 'scale' && (
            <ScalePanel run={current.current_run ? detailRun : null} page={detail} project={project.data} canEdit={canRun} />
          )}
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
          {tab === 'model' && <ModelPanel projectId={projectId} memberId={selectedId} onPickMember={selectFromList} />}
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
          previewUrl={previewUrl}
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
            pickingPen
              ? 'Click a line on the drawing to see its pen (line width and colour)'
              : boxRemoving
              ? 'Drag a box around the false finds to remove: the columns and members inside it'
              : drawingArea
              ? 'Drag a box around the part of the sheet to count: what is outside is not counted'
              : findingSimilar
              ? 'Drag a box around a column symbol Steelo missed (or click on it): every mark drawn like it becomes a column'
              : pickingReference
              ? gridPoints?.length
                ? 'Click near the reference grid intersection (it snaps to the nearest one)'
                : 'Click the reference grid intersection'
              : undefined
          }
          columns={detailRun?.columns ?? undefined}
          onColumnClick={canRun && !reviewLocked ? setRemovingColumn : undefined}
          grids={detailRun?.grids ?? undefined}
          dimensionLines={detailRun?.dimension_lines}
          showGrids={showGrids}
          showDimensionLines={showDimensionLines}
          onPlace={place}
          boxing={findingSimilar || drawingArea || boxRemoving}
          area={(current.area as AreaBox | null | undefined) ?? null}
          onBox={(box) => {
            setPlacing(false)
            if (boxRemoving) {
              setBoxRemoving(false)
              const [l, b, r, t] = box
              const inside = (x: number, y: number) => l <= x && x <= r && b <= y && y <= t
              const columns = (detailRun?.columns ?? []).filter((c) => inside(c.x, c.y)).length
              const members = allMembers.filter((m) => {
                if (!m.label_bbox || m.review_status === 'rejected' || m.review_status === 'unsupported') return false
                if ((m.original as { source?: string } | null)?.source === 'column_symbol') return false
                const [ml, mb, mr, mt] = m.label_bbox
                return inside((ml! + mr!) / 2, (mb! + mt!) / 2)
              }).length
              boxRemoval.reset()
              return setBoxFound({ box, columns, members, take: { columns: columns > 0, members: members > 0 } })
            }
            if (drawingArea) {
              setDrawingArea(false)
              return setProposedArea({ area: box })
            }
            setFindingSimilar(false)
            setSimilar(null)
            findSimilar.mutate({ point: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], box })
          }}
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
                  aria-pressed={pickingPen}
                  title="Click a line to see its pen, and read the project's members or grid lines by it"
                  onClick={() => {
                    if (pickingPen) return cancelPlace()
                    setAdding(null)
                    setPickingReference(false)
                    setFindingSimilar(false)
                    setDrawingArea(false)
                    setBoxRemoving(false)
                    setPickingPen(true)
                    setPlacing(true)
                  }}
                >
                  Pens
                </Button>
              )}
              {lastRemoved?.pageId === pageId && canRun && (
                <>
                  <Button
                    loading={findLike.isPending}
                    title="Find the columns on this page drawn like the one you removed"
                    onClick={() => findLike.mutate(lastRemoved.points[0]!)}
                  >
                    Remove all like this
                  </Button>
                  <Button
                    loading={columnRemoval.isPending}
                    onClick={() => columnRemoval.mutate({ points: lastRemoved.points, undo: true })}
                  >
                    Undo remove
                  </Button>
                </>
              )}
              <PageAreaControls
                page={current}
                canEdit={canRun}
                drawing={drawingArea}
                onDraw={() => {
                  if (drawingArea) return cancelPlace()
                  setAdding(null)
                  setPickingReference(false)
                  setFindingSimilar(false)
                  setPickingPen(false)
                  setBoxRemoving(false)
                  setDrawingArea(true)
                  setPlacing(true)
                }}
                proposed={proposedArea}
                onPropose={setProposedArea}
              />
              {canRun && current.current_run && (
                <Button
                  aria-pressed={findingSimilar}
                  loading={findSimilar.isPending}
                  title="Point at a column symbol Steelo missed: every mark drawn like it becomes a column"
                  onClick={() => {
                    if (findingSimilar) return cancelPlace()
                    setAdding(null)
                    setPickingReference(false)
                    setDrawingArea(false)
                    setPickingPen(false)
                    setBoxRemoving(false)
                    setFindingSimilar(true)
                    setPlacing(true)
                  }}
                >
                  Find similar
                </Button>
              )}
              {canRun && !reviewLocked && current.current_run && (
                <Button
                  aria-pressed={boxRemoving}
                  title="Drag a box round columns or members Steelo found wrongly, to remove them together"
                  onClick={() => {
                    if (boxRemoving) return cancelPlace()
                    setAdding(null)
                    setPickingReference(false)
                    setDrawingArea(false)
                    setPickingPen(false)
                    setFindingSimilar(false)
                    setBoxRemoving(true)
                    setPlacing(true)
                  }}
                >
                  Remove in box
                </Button>
              )}
              {lastBoxRemoved?.pageId === pageId && canRun && (
                <Button loading={undoBoxRemoval.isPending} onClick={() => undoBoxRemoval.mutate(lastBoxRemoved.removed)}>
                  Undo box remove
                </Button>
              )}
              {findSimilar.error && (
                <span className="field__error" role="alert">
                  {toApiError(findSimilar.error).message}
                </span>
              )}
              {similar && !setSearch.job && (
                <span className="similar-result" role="status">
                  {similar.result.added
                    ? `${similar.result.added} column${similar.result.added === 1 ? '' : 's'} added on this page.`
                    : 'No new columns: those found are already columns.'}{' '}
                  <Button
                    loading={setSearch.starting}
                    onClick={() => {
                      setSearch.start(similar.point)
                    }}
                  >
                    Also on every plan of this set
                  </Button>
                  <Button aria-label="Dismiss" onClick={() => setSimilar(null)}>
                    ×
                  </Button>
                </span>
              )}
              {setSearch.startError && (
                <span className="field__error" role="alert">
                  {setSearch.startError.message}
                </span>
              )}
              {setSearch.job && (
                <SetSimilarSearchStatus
                  job={setSearch.job}
                  onDismiss={() => {
                    setSearch.dismiss()
                    setSimilar(null)
                  }}
                />
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
              {Boolean(detailRun?.dimension_lines?.length) && (
                <label className="checkbox" title="Lines at the ends of dimensions printed from a grid line. Shown only: they change no lengths.">
                  <input type="checkbox" checked={showDimensionLines} onChange={(e) => setShowDimensionLines(e.target.checked)} /> Dimension lines (
                  {detailRun!.dimension_lines.length})
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

      <ConfirmDialog
        open={removingColumn !== null}
        title="Remove this column?"
        confirmLabel="Remove column"
        pending={columnRemoval.isPending}
        error={columnRemoval.error ? toApiError(columnRemoval.error).message : null}
        onConfirm={() => removingColumn && columnRemoval.mutate({ points: [[removingColumn.x, removingColumn.y]], undo: false })}
        onCancel={() => {
          setRemovingColumn(null)
          columnRemoval.reset()
        }}
      >
        <p>
          Steelo found a column here that isn’t one. It is taken off this page and stays off when the page runs again; if it
          has an ABM entry, that entry is rejected. Undo brings it back.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={boxFound !== null}
        title="Remove what is in this box?"
        confirmLabel="Remove"
        pending={boxRemoval.isPending}
        error={boxRemoval.error ? toApiError(boxRemoval.error).message : null}
        onConfirm={() => {
          if (boxFound && (boxFound.take.columns || boxFound.take.members)) boxRemoval.mutate({ box: boxFound.box, take: boxFound.take })
        }}
        onCancel={() => setBoxFound(null)}
      >
        {boxFound && (
          <>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={!boxFound.columns}
                checked={boxFound.take.columns}
                onChange={(e) => setBoxFound({ ...boxFound, take: { ...boxFound.take, columns: e.target.checked } })}
              />{' '}
              {boxFound.columns} column{boxFound.columns === 1 ? '' : 's'}
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                disabled={!boxFound.members}
                checked={boxFound.take.members}
                onChange={(e) => setBoxFound({ ...boxFound, take: { ...boxFound.take, members: e.target.checked } })}
              />{' '}
              {boxFound.members} member{boxFound.members === 1 ? '' : 's'}
            </label>
            <p className="muted">
              Columns are taken off this page and stay off when it runs again; members are rejected. Members you accepted,
              edited or added are kept. Undo box remove brings it all back.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={likeFound !== null}
        title={likeFound?.length ? `Remove ${likeFound.length} columns drawn like this?` : 'No other column is drawn like it'}
        confirmLabel={likeFound?.length ? `Remove ${likeFound.length} columns` : 'OK'}
        pending={removeAllLike.isPending}
        error={removeAllLike.error ? toApiError(removeAllLike.error).message : null}
        onConfirm={() => (likeFound?.length && lastRemoved ? removeAllLike.mutate(lastRemoved.points[0]!) : setLikeFound(null))}
        onCancel={() => setLikeFound(null)}
      >
        <p>
          {likeFound?.length
            ? 'Columns on this page whose drawing matches the one you removed, closely. Each is removed as you would one by one: it stays off when the page runs again, and Undo remove brings them all back.'
            : 'Steelo compares the drawing round each column with the one you removed; none on this page matches it closely.'}
        </p>
      </ConfirmDialog>

      {penPoint && project.data && (
        <PickedPenDialog project={project.data} pageId={pageId} point={penPoint} onClose={() => setPenPoint(null)} />
      )}

      {stripOpen && (
        <aside className="workspace__strip">
          {sheets !== 'all' && (
            <div className="page-strip__filter" role="group" aria-label="Pages shown">
              <span>{groupLabel(sheets)} only</span>
              <button
                type="button"
                className="link-button"
                onClick={() => navigate(`/projects/${projectId}/pages/${pageId}`, { replace: true })}
              >
                Show all pages
              </button>
            </div>
          )}
          <PageStrip pages={pages} currentId={pageId} setName={drawingSet.data.original_filename} onOpen={go} />
        </aside>
      )}
    </div>
  )
}

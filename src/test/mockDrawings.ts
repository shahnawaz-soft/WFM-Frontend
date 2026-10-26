import { http, HttpResponse } from 'msw'

import { ApiError } from '../api/errors'

import type { DrawingPage, DrawingSet } from '../api/types'
import { mockBackend } from './mockBackend'
import { mockProjects } from './mockProjects'

/** Mirrors steelo.drawings for frontend tests (upload, duplicates, page states, retry). */
type Mutable<T> = { -readonly [K in keyof T]: T[K] }

interface StoredSet {
  set: Mutable<DrawingSet>
  pages: DrawingPage[]
  sha: string
}

let sets: StoredSet[] = []
/** Set-wide find-similar jobs, by id. */
let similarJobs: Record<string, Record<string, unknown>> = {}
let beamMarks: { mark: string; beams: number; length_mm: string; length_display: string; sections: string[]; pages: number[] }[] = []
let connectionLines: Record<string, unknown>[] = []
let connectionTemplates: { id: string; name: string; note: string; version: number; updated_at: string; lines: ReturnType<typeof templateLine>[] }[] = []
/** Page numbers that will fail during the next ingestion (per filename). */
let failingPages: Record<string, number[]> = {}
/** Outcome of the next Run Plan per page number (default: completed vector drawing). */
type RunOutcome = 'completed' | 'needs_review' | 'failed' | 'stay_processing'
let runOutcomes: Record<number, RunOutcome> = {}
let jobCounter = 0
const runMembers: Record<string, unknown[]> = {}
const runIssues: Record<string, unknown[]> = {}

function member(pageId: string, runId: string, designation: string, profile: string, sequence: number, extra: string[] = []) {
  return {
    id: crypto.randomUUID(),
    page: pageId,
    run: runId,
    origin: 'automated',
    mark: '',
    member_type: '',
    designation,
    profile,
    size: designation.slice(profile.length),
    length_mm: null,
    quantity: 1,
    label_bbox: [100 + sequence * 50, 100, 140 + sequence * 50, 110],
    geometry: [],
    confidence: 0.6,
    low_confidence: true,
    warnings: ['length_not_determined', 'low_confidence', ...extra],
    review_status: 'unreviewed',
    is_corrected: false,
    original: { designation, length_mm: null, quantity: 1 },
    version: 1,
    length_display: '',
    weight: null as Amounts | null,
    ...sectionFor(designation),
  }
}

interface Amounts {
  lb: string
  kg: string
  short_tons: string
  tonnes: string
}
function amounts(lb: number): Amounts {
  const kg = lb * 0.45359237
  return { lb: lb.toFixed(1), kg: kg.toFixed(1), short_tons: (lb / 2000).toFixed(3), tonnes: (kg / 1000).toFixed(3) }
}
/** Same rule as the server: lb/ft × length × quantity, only with a section and a length. */
function weigh(m: { section: { weight_lb_per_ft: string } | null; length_mm: unknown; quantity: number; weight: Amounts | null }) {
  m.weight = m.section && m.length_mm != null ? amounts((Number(m.section.weight_lb_per_ft) * Number(m.length_mm) * m.quantity) / 304.8) : null
}

type MockMember = ReturnType<typeof member>

/** Mock catalogue: W12X26 and W10X12 exist; anything else is "not in section data". */
const CATALOGUE: Record<string, [string, string]> = { W12X26: ['26.000', '38.692'], W10X12: ['12.000', '17.858'], W24X76: ['76.000', '113.100'] }
function sectionFor(designation: string) {
  const hit = CATALOGUE[designation]
  if (designation.startsWith('HSS')) return { match_status: 'unsupported', unit_weight_kg_per_m: null, section: null }
  return hit
    ? { match_status: 'matched', unit_weight_kg_per_m: hit[1], section: { id: `p-${designation}`, designation, weight_lb_per_ft: hit[0], weight_kg_per_m: hit[1] } }
    : { match_status: 'unmatched', unit_weight_kg_per_m: null, section: null }
}
const revisions: Record<string, { id: string; action: string; actor: string; before: object; after: object; reason: string; created_at: string }[]> = {}

function findMember(id: string): { member: MockMember; pageId: string } | null {
  for (const [pageId, list] of Object.entries(runMembers)) {
    const m = (list as MockMember[]).find((x) => x.id === id)
    if (m) return { member: m, pageId }
  }
  return null
}

function pageById(id: string) {
  return sets.flatMap((s) => s.pages).find((p) => p.id === id) as Mutable<DrawingPage> | undefined
}

const err = (status: number, code: string, message: string, details: unknown = {}) =>
  HttpResponse.json({ error: { code, message, details, request_id: 'r' } }, { status })

function revise(m: MockMember, action: string, before: object, after: object, reason = '') {
  ;(revisions[m.id] ??= []).unshift({ id: crypto.randomUUID(), action, actor: 'Esha Estimator', before, after, reason, created_at: new Date().toISOString() })
  m.version += 1
}

/** Very small length parser for the mock: 24'-3" / 291" / 7391 mm / bare mm. */
function parseLength(text: string): number | null | 'invalid' {
  if (!text.trim()) return null
  const ft = /^(\d+)'(?:\s*-?\s*(\d+)")?$/.exec(text.trim())
  if (ft) return Math.round((Number(ft[1]) * 12 + Number(ft[2] ?? 0)) * 254) / 10
  const mm = /^(\d+(?:\.\d+)?)\s*(mm)?$/.exec(text.trim())
  if (mm) return Number(mm[1])
  return 'invalid'
}

function display(mm: number | null): string {
  if (mm == null) return ''
  const inches = Math.round(mm / 25.4)
  return `${Math.floor(inches / 12)}'-${inches % 12}"`
}

type AbmMock = MockMember & { page_number: number; drawing_set: { id: string; original_filename: string }; source: string }

const DRAFT_STATES = ['processed', 'reviewed', 'added']

/** Current members of pages added to the project (or, as a draft, of every page that has been
 *  run), shaped as ABM entries. */
function abmMembers(projectId: string, includeRejected: boolean, draft = false): AbmMock[] {
  return sets
    .filter((x) => x.set.project === projectId)
    .flatMap((x) =>
      x.pages
        .filter((p) => (draft ? DRAFT_STATES.includes(p.status) : p.status === 'added'))
        .flatMap((p) =>
          ((runMembers[p.id] ?? []) as MockMember[]).map((m) => ({
            ...m,
            page_number: p.page_number,
            drawing_set: { id: x.set.id, original_filename: x.set.original_filename },
            source: m.origin === 'manual' ? 'manual' : m.is_corrected ? 'corrected' : 'detected',
          })),
        ),
    )
    .filter((m) => includeRejected || m.review_status !== 'rejected')
}

/** A plausible project timeline for the history screen (newest first, one minute apart). */
function historyFor(projectId: string) {
  const item = (minute: number, category: string, action: string, summary: string, extra: object = {}) => ({
    id: crypto.randomUUID(),
    occurred_at: new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString(),
    category,
    action,
    summary,
    actor: { id: 'u-1', full_name: 'Esha Estimator' },
    actor_type: 'user',
    page: null,
    member_id: null,
    before: null,
    after: null,
    reason: '',
    is_error: false,
    ...extra,
  })
  const items = [item(0, 'project', 'project.created', 'Created the project “Warehouse”')]
  let minute = 1
  for (const x of sets.filter((s) => s.set.project === projectId)) {
    items.push(item(minute++, 'pages', 'drawing_set.uploaded', `Uploaded ${x.set.original_filename} (${x.set.page_count} pages)`))
    for (const p of x.pages.filter((p) => p.current_run)) {
      const ref = { id: p.id, page_number: p.page_number, drawing_set: { id: x.set.id, original_filename: x.set.original_filename } }
      items.push(item(minute++, 'processing', 'page.run_requested', `Ran Run Plan on page ${p.page_number} of ${x.set.original_filename}`, { page: ref }))
      items.push(item(minute++, 'processing', 'job.completed', `Run Plan finished on page ${p.page_number} of ${x.set.original_filename}: 3 members found`, { page: ref, actor_type: 'job' }))
      for (const m of (runMembers[p.id] ?? []) as MockMember[]) {
        for (const r of [...(revisions[m.id] ?? [])].reverse()) {
          items.push(item(minute++, 'members', `member.${r.action}`, `${r.action === 'edited' ? 'Corrected' : 'Reviewed'} ${m.designation} on page ${p.page_number} of ${x.set.original_filename}`, { page: ref, member_id: m.id, reason: r.reason ?? '' }))
        }
      }
    }
  }
  items.push(item(minute++, 'processing', 'job.failed', 'Run Plan failed on page 9 of old.pdf: The page could not be read.', { actor_type: 'job', is_error: true }))
  return items.reverse()
}

/** Wireframe revisions (generated synchronously by the mock, same placement rules). */
interface MockWireframe {
  project: string
  id: string
  revision_no: number
  status: string
  created_by: string
  created_at: string
  finished_at: string
  error_code: string
  error_message: string
  summary: object
  elements: Record<string, unknown>[]
  reviewed_at?: string | null
  reviewed_by?: string | null
  remaining_work?: object
  copied_from_revision?: number | null
}

function countsOf(w: MockWireframe) {
  const current = w.elements.filter((e) => !e.removed)
  const n = (pred: (e: Record<string, unknown>) => boolean) => current.filter(pred).length
  return {
    elements: current.length,
    by_type: { beam: n((e) => e.element_type === 'beam'), column: n((e) => e.element_type === 'column') },
    by_completeness: { ok: n((e) => e.completeness === 'ok'), missing_data: n((e) => e.completeness === 'missing_data'), unsupported: n((e) => e.completeness === 'unsupported') },
    edited: n((e) => e.provenance === 'edited'),
    added: n((e) => e.provenance === 'added'),
    removed: w.elements.length - current.length,
    columns_without_size: n((e) => e.element_type === 'column' && !e.designation),
  }
}

/** The project's added pages as a wireframe summary records them (backend ``page_entry``). */
function addedPageEntries(projectId: string) {
  return sets
    .filter((x) => x.set.project === projectId)
    .flatMap((x) =>
      x.pages
        .filter((p) => p.status === 'added')
        .map((p) => ({
          id: p.id,
          page_number: p.page_number,
          original_filename: x.set.original_filename,
          level_label: p.level_label ?? '',
          elevation_mm: p.elevation_mm != null ? String(p.elevation_mm) : null,
        })),
    )
}

type PageEntry = ReturnType<typeof addedPageEntries>[number]

function changesSince(w: MockWireframe) {
  const built = new Map(((w.summary as { pages?: PageEntry[] }).pages ?? []).map((p) => [p.id, p]))
  const added: PageEntry[] = []
  const changed: PageEntry[] = []
  for (const now of addedPageEntries(w.project)) {
    const before = built.get(now.id)
    built.delete(now.id)
    if (!before) added.push(now)
    else if (before.level_label !== now.level_label || before.elevation_mm !== now.elevation_mm) changed.push(now)
  }
  return { pages_added: added, pages_removed: [...built.values()], set_up_changed: changed }
}

function wireframeOut(w: MockWireframe) {
  const { elements: _e, project: _p, ...rest } = w
  const latest = Math.max(...wireframes.filter((x) => x.project === w.project).map((x) => x.revision_no))
  const isLatest = w.revision_no === latest
  return {
    reviewed_at: null,
    reviewed_by: null,
    remaining_work: {},
    copied_from_revision: null,
    ...rest,
    counts: countsOf(w),
    is_latest: isLatest,
    changes_since: isLatest && w.status !== 'generating' ? changesSince(w) : null,
  }
}

function findElement(id: string) {
  for (const w of wireframes) {
    const e = w.elements.find((x) => x.id === id)
    if (e) return { w, e }
  }
  return null
}

/** "14'" / "14'-0\"" / "4267 mm" / number → mm string. */
function coordinate(v: unknown): string {
  if (typeof v === 'number') return v.toFixed(1)
  const text = String(v).trim()
  const negative = text.startsWith('-')
  const body = negative ? text.slice(1) : text
  const parsed = /^0+(\s*(mm|'))?$/.test(body) ? 0 : parseLength(body)
  if (parsed === 'invalid' || parsed == null) throw new Error('bad coordinate')
  return ((negative ? -1 : 1) * parsed).toFixed(1)
}
let wireframes: MockWireframe[] = []

const NOT_PLAN = ['elevation', 'section', 'detail', 'schedule']
const isPlan = (p: { id: string }) => !NOT_PLAN.includes(sheetKinds[p.id] ?? 'plan')

function setupOf(p: Mutable<DrawingPage>) {
  if (!isPlan(p)) return []
  const missing = [
    ...(p.elevation_mm == null ? ['level_missing'] : []),
    ...(p.reference_point ? [] : ['reference_missing']),
    ...(p.current_run?.scale_ratio ? [] : ['scale_missing']),
  ]
  return missing
}

function generateMock(projectId: string, user: string): MockWireframe {
  const pages = sets.filter((x) => x.set.project === projectId).flatMap((x) => x.pages.filter((p) => p.status === 'added'))
  const elements = pages.flatMap((p) =>
    ((runMembers[p.id] ?? []) as MockMember[])
      .filter((m) => m.review_status !== 'rejected')
      .map((m) => {
        const issues = [...setupOf(p)]
        if (m.geometry.length < 2) issues.push('no_geometry')
        if (m.review_status !== 'accepted') issues.push('not_accepted')
        const placed = !issues.some((i) => i !== 'not_accepted')
        const factor = ((p.current_run?.scale_ratio ?? 0) * 25.4) / 72
        const [rx, ry] = (p.reference_point ?? [0, 0]) as number[]
        const at = ([x, y]: number[]) => [((x! - rx!) * factor).toFixed(1), ((y! - ry!) * factor).toFixed(1), Number(p.elevation_mm).toFixed(1)]
        const span = m.geometry as unknown as number[][]
        const start = placed ? at(span[0]!) : null
        const end = placed ? at(span[1]!) : null
        const length = start && end ? Math.hypot(Number(end[0]) - Number(start[0]), Number(end[1]) - Number(start[1])) : null
        return {
          id: crypto.randomUUID(),
          element_type: 'beam',
          designation: m.designation,
          profile: m.profile,
          quantity: m.quantity,
          level_label: p.level_label,
          start,
          end,
          length_mm: length?.toFixed(1) ?? null,
          length_display: display(length),
          provenance: 'generated',
          completeness: m.warnings.includes('unsupported_profile') ? 'unsupported' : placed ? 'ok' : 'missing_data',
          issues,
          issue_messages: issues.map((i) => ({ no_geometry: 'No measured span.', level_missing: 'The page has no level elevation.', reference_missing: 'The page has no reference grid point.', not_accepted: 'The member is not accepted yet.' })[i] ?? i),
          source_member: m.id,
          source_page: p.id,
          page_number: p.page_number,
          details: {},
          version: 1,
        }
      }),
  )
  for (const p of pages) {
    const missing = setupOf(p)
    const factor = ((p.current_run?.scale_ratio ?? 0) * 25.4) / 72
    const [rx, ry] = (p.reference_point ?? [0, 0]) as number[]
    for (const c of p.current_run?.columns ?? []) {
      const at = (z: number) => [((c.x - rx!) * factor).toFixed(1), ((c.y - ry!) * factor).toFixed(1), z.toFixed(1)]
      const placed = !missing.length
      elements.push({
        id: crypto.randomUUID(),
        element_type: 'column',
        designation: '',
        profile: '',
        quantity: 1,
        level_label: p.level_label,
        start: placed ? at(0) : null,
        end: placed ? at(Number(p.elevation_mm)) : null,
        length_mm: placed ? Number(p.elevation_mm).toFixed(1) : null,
        length_display: placed ? display(Number(p.elevation_mm)) : '',
        provenance: 'generated',
        completeness: placed ? 'ok' : 'missing_data',
        issues: [...missing, 'size_not_shown'],
        issue_messages: ['Found from its column symbol; the plan does not give its section.'],
        details: { source: 'symbol', shape: c.shape, depth_in: c.depth_in, flange_in: c.flange_in, web_axis: c.web_axis },
        source_member: null as unknown as ReturnType<typeof crypto.randomUUID>,
        source_page: p.id,
        page_number: p.page_number,
        version: 1,
      })
    }
  }
  const count = (key: string) => elements.filter((e) => e.completeness === key).length
  const w: MockWireframe = {
    project: projectId,
    id: crypto.randomUUID(),
    revision_no: wireframes.filter((x) => x.project === projectId).length + 1,
    status: 'draft',
    created_by: user,
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    error_code: '',
    error_message: '',
    summary: {
      elements: elements.length,
      by_type: { beam: elements.filter((e) => e.element_type === 'beam').length, column: elements.filter((e) => e.element_type === 'column').length },
      by_completeness: Object.fromEntries(['ok', 'missing_data', 'unsupported'].map((k) => [k, count(k)]).filter(([, n]) => n)),
      by_issue: {},
      levels: [...new Set(pages.filter((p) => p.elevation_mm != null).map((p) => `${p.level_label}|${p.elevation_mm}`))].map((key) => {
        const [label, elevation] = key.split('|')
        return { label, elevation_mm: elevation, pages: 1 }
      }),
      pages: addedPageEntries(projectId),
    },
    elements,
  }
  wireframes.push(w)
  return w
}

function summaryFor(projectId: string) {
    const dataset = mockProjects.sectionDataset
    const pages = sets.filter((x) => x.set.project === projectId).flatMap((x) => x.pages.map((p) => ({ p, x })))
    const count = (status: string) => pages.filter(({ p }) => p.status === status).length
    const reasonOf = (status: string) => ({ failed: 'failed', processed: 'not_reviewed', reviewed: 'not_added' })[status]
    const attention = pages
      .filter(({ p }) => reasonOf(p.status))
      .map(({ p, x }) => ({
        id: p.id,
        page_number: p.page_number,
        drawing_set: { id: x.set.id, original_filename: x.set.original_filename },
        status: p.status,
        reason: reasonOf(p.status)!,
        message: p.status === 'failed' ? p.error_message || 'Processing failed.' : p.status === 'processed' ? 'Processed; its members are not reviewed yet.' : 'Reviewed but not added to the project.',
      }))
    const entries = abmMembers(projectId, false)
    const lb = (list: AbmMock[]) => list.reduce((n, e) => n + (e.weight ? Number(e.weight.lb) : 0), 0)
    const reviewed = entries.filter((e) => e.weight && e.review_status === 'accepted')
    const awaiting = entries.filter((e) => e.weight && e.review_status !== 'accepted')
    const exceptions: { code: string; count: number; message: string }[] = []
    if (!dataset) exceptions.push({ code: 'no_section_data', count: 1, message: 'No approved section data, so nothing can be weighed.' })
    const add = (code: string, list: AbmMock[], text: string) => list.length && exceptions.push({ code, count: list.length, message: `${list.length} ${text}` })
    add('entries_awaiting_review', awaiting, 'entries are awaiting review.')
    add('entries_no_length', entries.filter((e) => !e.weight && e.section), 'entries have no length.')
    add('entries_not_in_section_data', entries.filter((e) => !e.weight && !e.section && e.match_status !== 'unsupported'), 'entries are not in the section data (check the section).')
    add('entries_unsupported', entries.filter((e) => e.match_status === 'unsupported'), 'entries are of an unsupported section type and are not weighed.')
    const added = count('added')
    const state = !added && !count('processed') && !count('reviewed') && !count('failed') ? 'not_started' : added && !exceptions.length ? 'ready' : 'in_progress'
    return {
      state,
      pages: { total: pages.length, pending: count('pending'), processing: count('processing'), processed: count('processed'), reviewed: count('reviewed'), added, failed: count('failed'), needs_review: 0 },
      drawing_sets: sets.filter((x) => x.set.project === projectId).length,
      pages_requiring_attention: {
        count: attention.length,
        by_reason: { failed: count('failed'), needs_review: 0, not_reviewed: count('processed'), not_added: count('reviewed') },
        pages: attention,
      },
      exceptions,
      abm: { entries: entries.length, pages: added, complete: added > 0 && !exceptions.length },
      tonnage: { reviewed: amounts(lb(reviewed)), not_final: amounts(lb(awaiting)) },
      outputs: { abm: state === 'ready' ? 'ready' : entries.length ? 'in_progress' : 'not_started', wireframe: wireframes.filter((w) => w.project === projectId).at(-1)?.status ?? 'not_generated', finalized: mockProjects.all.find((p) => p.id === projectId)?.status === 'finalized', versions: versions.filter((v) => v.project === projectId).length },
      section_dataset: dataset ? { label: dataset.label, is_test: false } : null,
      last_activity: { occurred_at: '2026-10-06T09:30:00Z', actor: 'Esha Estimator', action: 'project.created' },
    }
}

interface MockVersion {
  id: string
  project: string
  version_no: number
  created_at: string
  finalized_by: string
  note: string
  exceptions: { code: string; count: number; message: string }[]
  exceptions_acknowledged: boolean
  summary: object
  snapshot_sha256: string
  snapshot_bytes: number
  reopened_at: string | null
  reopened_by: string | null
  reopen_reason: string
  is_current: boolean
}
let versions: MockVersion[] = []

function checkFor(projectId: string) {
  const summary = summaryFor(projectId)
  const blocking = summary.abm.pages === 0 ? [{ code: 'no_pages_added', message: 'No page has been added to the project, so there is nothing to finalise.' }] : []
  const project = mockProjects.all.find((p) => p.id === projectId)!
  const wireframe = wireframes.filter((w) => w.project === projectId).at(-1)
  return {
    status: project.status,
    can_finalize: project.status === 'active' && !blocking.length,
    blocking,
    exceptions: summary.exceptions,
    requires_acknowledgement: summary.exceptions.length > 0,
    pages_not_included: summary.pages_requiring_attention,
    abm: summary.abm,
    tonnage: summary.tonnage,
    wireframe: wireframe ? { revision_no: wireframe.revision_no, status: wireframe.status } : null,
    next_version: versions.filter((v) => v.project === projectId).length + 1,
  }
}

const LIMITS = {
  allowed_extensions: ['pdf'],
  max_upload_mb: 200,
  max_pages: 300,
  notes: ['Password-protected PDFs cannot be processed.'],
}

function counts(s: StoredSet): DrawingSet {
  const ready = s.pages.filter((p) => p.thumbnail_status === 'ready').length
  const failed = s.pages.filter((p) => p.thumbnail_status === 'failed').length
  return { ...s.set, pages_ready: ready, pages_failed: failed, can_retry: failed > 0 || s.set.status === 'failed' }
}

function ingest(s: StoredSet) {
  const failing = failingPages[s.set.original_filename] ?? []
  for (const page of s.pages) {
    if (page.thumbnail_status === 'ready') continue
    if (failing.includes(page.page_number)) {
      Object.assign(page, {
        status: 'failed',
        thumbnail_status: 'failed',
        error_code: 'page_unreadable',
        error_message: `Page ${page.page_number} could not be read. The rest of the drawing set is unaffected. Retry, or review this page manually.`,
      })
    } else {
      Object.assign(page, { status: 'pending', thumbnail_status: 'ready', error_code: '', error_message: '' })
    }
  }
  Object.assign(s.set, { status: 'ready', error_code: '', error_message: '' })
}

/** Sheet kinds the engine read, by page id (default: plan). */
let sheetKinds: Record<string, string> = {}
/** Pages whose drawings mark no elevation for their level (the proposal has none). */
let noProposedElevation = new Set<string>()

export const mockDrawings = {
  reset() {
    sets = []
    similarJobs = {}
    connectionLines = []
    connectionTemplates = []
    wireframes = []
    versions = []
    failingPages = {}
    runOutcomes = {}
    sheetKinds = {}
    noProposedElevation = new Set()
    beamMarks = []
  },
  /** Beams known by a mark only, as the ABM's Beam marks tab lists them. */
  setBeamMarks(rows: typeof beamMarks) {
    beamMarks = rows
  },
  sheetKind(pageId: string, kind: string) {
    sheetKinds[pageId] = kind
  },
  noElevationProposed(pageId: string) {
    noProposedElevation.add(pageId)
  },
  runOutcome(pageNumber: number, outcome: RunOutcome) {
    runOutcomes[pageNumber] = outcome
  },
  failPages(filename: string, pages: number[]) {
    failingPages[filename] = pages
  },
  get sets() {
    return sets
  },
}

/** Page count is encoded in the test file content as "pages:N". */
function pageCountOf(text: string) {
  return Number(/pages:(\d+)/.exec(text)?.[1] ?? 1)
}

const reject = (status: number, code: string, message: string) => {
  throw new ApiError({ status, code, message, details: { file: [message] } })
}

/**
 * In-process stand-in for POST /projects/:id/drawing-sets/ (same rules and errors as the
 * server). Used instead of MSW because jsdom's XHR drops multipart file contents and names.
 */
export async function acceptUpload(
  projectId: string,
  file: File,
  options: { confirmDuplicate?: boolean; onProgress?: (fraction: number) => void } = {},
): Promise<DrawingSet> {
  const user = mockBackend.state.users.find((u) => u.id === mockBackend.state.sessionUserId)!
  const project = mockProjects.all.find((p) => p.id === projectId)!
  if (project.status === 'archived') reject(403, 'project_archived', 'This project is archived and read-only.')
  const text = await file.text()
  if (!text.startsWith('%PDF-')) reject(400, 'unsupported_file_type', 'This file is not a PDF, even though its name ends in .pdf.')
  const existing = sets.find((s) => s.set.project === projectId && s.sha === text)
  if (existing && !options.confirmDuplicate) {
    reject(409, 'duplicate_drawing_set', `This file was already uploaded to this project as “${existing.set.original_filename}”.`)
  }
  options.onProgress?.(0.5)
  options.onProgress?.(1)
  const id = crypto.randomUUID()
  const pageCount = pageCountOf(text)
  const stored: StoredSet = {
    sha: text,
    set: {
      id,
      project: projectId,
      original_filename: file.name,
      size_bytes: file.size,
      page_count: pageCount,
      status: 'processing',
      error_code: '',
      error_message: '',
      ingest_attempts: 1,
      uploaded_by: { id: user.id, email: user.email, username: user.username, full_name: user.full_name, is_active: true },
      created_at: new Date().toISOString(),
      ingested_at: null,
      pages_ready: 0,
      pages_failed: 0,
      can_retry: false,
    } as DrawingSet,
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: crypto.randomUUID(),
      drawing_set: id,
      page_number: i + 1,
      status: 'pending',
      thumbnail_status: 'pending',
      width_pt: 2384,
      height_pt: 1684,
      rotation: 0,
      error_code: '',
      error_message: '',
      latest_job: null,
      current_run: null,
      level_label: '',
      elevation_mm: null,
      elevation_display: '',
      reference_point: null,
      reference_label: '',
    })) as DrawingPage[],
  }
  sets.push(stored)
  const created = counts(stored)
  ingest(stored) // the "background job" finishes before the next poll
  return created
}

const syncedProjects = new Set<string>()

function levelProposals(projectId: string) {
  const pages = sets.filter((x) => x.set.project === projectId).flatMap((x) => x.pages.filter((p) => ['processed', 'reviewed', 'added'].includes(p.status)).map((p) => ({ p, file: x.set.original_filename })))
  return {
    reference_label: pages.length ? 'A/1' : '',
    pages: pages.map(({ p, file }) => ({
      page_id: p.id,
      page_number: p.page_number,
      original_filename: file,
      current: { level_label: p.level_label, elevation_mm: p.elevation_mm, reference_label: p.reference_label, has_reference_point: Boolean(p.reference_point) },
      level_label: 'LEVEL 2',
      ...(noProposedElevation.has(p.id)
        ? { elevation_mm: null, elevation_display: '', elevation_source: null }
        : { elevation_mm: '4267.2', elevation_display: "14'-0\"", elevation_source: { page_id: p.id, page_number: 9, text: "2ND TOS 14' - 0\"" } }),
      alternatives: [],
      reference_label: 'A/1',
      reference_point: [150, 95],
      issues: noProposedElevation.has(p.id) ? ['no_elevation_marked'] : [],
    })),
  }
}

function columnSchedule(projectId: string) {
  const pages = sets.filter((x) => x.set.project === projectId).flatMap((x) => x.pages.filter((p) => p.status === 'added'))
  const placed = pages.filter((p) => p.elevation_mm != null && p.reference_point)
  const levels = placed.map((p) => ({ level_label: p.level_label, elevation_mm: p.elevation_mm, elevation_display: p.elevation_display }))
  const synced = syncedProjects.has(projectId)
  const stacks = (placed[0]?.current_run?.columns ?? []).map((c, i) => ({
    grid: i === 0 ? 'A/1' : '',
    x: String(c.x),
    y: String(c.y),
    cells: placed.map((p) => ({
      page_id: p.id,
      page_number: p.page_number,
      level_label: p.level_label,
      elevation_mm: p.elevation_mm,
      designation: '',
      source: 'symbol',
      member_id: synced ? `col-${i}-${p.id}` : null,
      in_bill: true,
      same_as_page: null,
      size_from_page: null,
      schedule_page: null,
      height_mm: p.elevation_mm,
      height_display: p.elevation_display,
      base_mm: '0.0',
      issues: ['base_assumed', 'size_not_given'],
      issue_messages: ['No level below: the column is taken to start at elevation 0.', "The plan doesn't give this column's section: enter it in the ABM."],
    })),
  }))
  const cells = stacks.flatMap((st) => st.cells)
  // Storeys as the server derives them: base → base + height of the counted cells.
  const storeys = [...new Map(placed.map((p) => [p.elevation_mm, p])).values()].map((p) => ({
    base_mm: '0.0',
    top_mm: String(p.elevation_mm),
    base_display: "0'-0\"",
    top_display: p.elevation_display,
    base_levels: [],
    top_levels: [p.level_label],
  }))
  return {
    levels,
    storeys,
    stacks,
    skipped_pages: pages.filter((p) => !p.reference_point).map((p) => ({ page_id: p.id, page_number: p.page_number, missing: ['reference_missing'] })),
    columns: cells.length,
    without_size: cells.length,
    not_in_bill: synced ? 0 : cells.length,
  }
}

const connectionLb = () => connectionLines.reduce((sum, l) => sum + Number((l.weight as Amounts | null)?.lb ?? 0), 0)

/** Connection material, manual lines worked out like the server (plates weighed by size). */
type MockLineInput = { kind: string; description: string; length?: string; spacing?: string; quantity?: number; grade?: string; finish?: string }

const feetInchesMm = (text = '') => {
  const m = /^(\d+)'-(\d+)"$/.exec(text)
  return m ? (Number(m[1]) * 12 + Number(m[2])) * 25.4 : null
}

function templateLine(line: MockLineInput) {
  const length = feetInchesMm(line.length)
  const spacing = feetInchesMm(line.spacing)
  return {
    kind: line.kind as 'manual',
    description: line.description,
    length_mm: length != null ? length.toFixed(1) : null,
    length_display: line.length ?? '',
    spacing_mm: spacing != null ? spacing.toFixed(1) : null,
    spacing_display: line.spacing ?? '',
    quantity: line.quantity ?? 1,
    grade: line.grade ?? '',
    finish: line.finish ?? '',
  }
}

function connectionLine(memberId: string, line: MockLineInput, templateName = '') {
  const { member } = findMember(memberId)!
  const pieces = (line.quantity ?? 1) * member.quantity
  const lengthMm = feetInchesMm(line.length)
  const plate = /^PL(\d+)\/(\d+)X(\d+)/i.exec(line.description)
  const lbPerFt = plate ? ((490 / 144) * Number(plate[1]) * Number(plate[3])) / Number(plate[2]) : null
  const total = lengthMm != null ? lengthMm * pieces : null
  return {
    id: crypto.randomUUID(),
    member: memberId,
    member_designation: member.designation,
    member_length_display: '',
    page: '',
    kind: line.kind,
    description: line.description,
    length_mm: lengthMm,
    length_display: line.length ?? '',
    spacing_mm: null,
    spacing_display: '',
    quantity: line.quantity ?? 1,
    grade: line.grade ?? '',
    finish: line.finish ?? '',
    version: 1,
    batch: crypto.randomUUID(),
    template_name: templateName,
    pieces,
    piece_length_display: line.length ?? '',
    total_length_mm: total,
    total_length_display: total != null ? `${Math.floor(total / 304.8)}'-${Math.round((total % 304.8) / 25.4)}"` : '',
    unit_weight_lb_per_ft: lbPerFt?.toFixed(3) ?? null,
    weight: lbPerFt != null && total != null ? amounts((lbPerFt * total) / 304.8) : null,
    reason: lbPerFt == null ? 'not_weighed' : '',
  }
}

export const drawingHandlers = [
  http.get('*/api/v1/projects/:id/connection-material/', ({ request }) => {
    const member = new URL(request.url).searchParams.get('member')
    const lines = connectionLines.filter((l) => !member || l.member === member)
    return HttpResponse.json({ lines, totals: { lines: lines.length, weight: amounts(connectionLb()), unweighed: 0 } })
  }),
  http.post('*/api/v1/projects/:id/connection-material/', async ({ request }) => {
    const body = (await request.json()) as { members: string[]; lines?: MockLineInput[]; template?: string }
    if (body.template) {
      const template = connectionTemplates.find((t) => t.id === body.template)!
      const created = body.members.flatMap((m) => template.lines.map((l) => connectionLine(m, { ...l, length: l.length_display }, template.name)))
      connectionLines.push(...created)
      return HttpResponse.json(created, { status: 201 })
    }
    const lines = body.lines ?? []
    if (lines.some((l) => !l.description.trim())) {
      return err(400, 'validation_error', 'Invalid input.', { description: ['Say what the material is, e.g. PL1/2X8 or L4X4X1/2.'] })
    }
    const created = body.members.flatMap((m) => lines.map((l) => connectionLine(m, l)))
    connectionLines.push(...created)
    return HttpResponse.json(created, { status: 201 })
  }),
  http.patch('*/api/v1/connection-material/:id/', async ({ params, request }) => {
    const body = (await request.json()) as MockLineInput & { version: number }
    const i = connectionLines.findIndex((l) => l.id === params.id)
    const old = connectionLines[i]!
    const line = { ...connectionLine(old.member as string, body, old.template_name as string), id: old.id, version: body.version + 1 }
    connectionLines[i] = line
    return HttpResponse.json(line)
  }),
  http.get('*/api/v1/connection-templates/', () => HttpResponse.json(connectionTemplates)),
  http.post('*/api/v1/connection-templates/', async ({ request }) => {
    const body = (await request.json()) as { name: string; note?: string; lines: MockLineInput[] }
    if (!body.name.trim()) return err(400, 'validation_error', 'Invalid input.', { name: ['Give the template a name, e.g. Shear tab W12.'] })
    if (connectionTemplates.some((t) => t.name.toLowerCase() === body.name.trim().toLowerCase())) {
      return err(400, 'validation_error', 'Invalid input.', { name: ['A template already has this name.'] })
    }
    const missing = body.lines.map((l) => (l.description.trim() ? {} : { description: ['Say what the material is.'] }))
    if (missing.some((m) => 'description' in m)) return err(400, 'validation_error', 'Invalid input.', { lines: missing })
    const template = { id: crypto.randomUUID(), name: body.name.trim(), note: body.note ?? '', version: 1, updated_at: new Date().toISOString(), lines: body.lines.map(templateLine) }
    connectionTemplates.push(template)
    return HttpResponse.json(template, { status: 201 })
  }),
  http.patch('*/api/v1/connection-templates/:id/', async ({ params, request }) => {
    const body = (await request.json()) as { version: number; name?: string; note?: string; lines?: MockLineInput[] }
    const t = connectionTemplates.find((x) => x.id === params.id)!
    Object.assign(t, { name: body.name ?? t.name, note: body.note ?? t.note, version: t.version + 1 })
    if (body.lines) t.lines = body.lines.map(templateLine)
    return HttpResponse.json(t)
  }),
  http.delete('*/api/v1/connection-templates/:id/', ({ params }) => {
    connectionTemplates = connectionTemplates.filter((t) => t.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.delete('*/api/v1/connection-material/:id/', ({ params }) => {
    connectionLines = connectionLines.filter((l) => l.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('*/api/v1/drawing-sets/limits/', () => HttpResponse.json(LIMITS)),

  http.get('*/api/v1/projects/:id/drawing-sets/', ({ params }) =>
    HttpResponse.json(sets.filter((s) => s.set.project === params.id).map(counts)),
  ),

  http.get('*/api/v1/drawing-sets/:id/', ({ params }) => {
    const s = sets.find((x) => x.set.id === params.id)
    return s ? HttpResponse.json(counts(s)) : HttpResponse.json({ error: { code: 'not_found', message: 'Not found.', details: {}, request_id: 'r' } }, { status: 404 })
  }),

  http.get('*/api/v1/drawing-sets/:id/file/', () =>
    new HttpResponse(new Uint8Array([37, 80, 68, 70]).buffer, { headers: { 'Content-Type': 'application/pdf' } }),
  ),

  http.get('*/api/v1/drawing-pages/:id/', ({ params }) => {
    const page = sets.flatMap((s) => s.pages).find((p) => p.id === params.id)
    return page
      ? HttpResponse.json(page)
      : HttpResponse.json({ error: { code: 'not_found', message: 'Page not found.', details: {}, request_id: 'r' } }, { status: 404 })
  }),

  http.get('*/api/v1/drawing-sets/:id/pages/', ({ params }) =>
    HttpResponse.json(sets.find((s) => s.set.id === params.id)!.pages),
  ),

  http.post('*/api/v1/drawing-sets/:id/retry/', ({ params }) => {
    const s = sets.find((x) => x.set.id === params.id)!
    s.set.ingest_attempts += 1
    delete failingPages[s.set.original_filename]
    for (const p of s.pages.filter((p) => p.thumbnail_status === 'failed')) {
      Object.assign(p, { status: 'pending', thumbnail_status: 'pending', error_message: '' })
    }
    ingest(s)
    return HttpResponse.json(counts(s), { status: 202 })
  }),

  http.delete('*/api/v1/drawing-sets/:id/', ({ params }) => {
    const s = sets.find((x) => x.set.id === params.id)!
    if (s.pages.some((p) => !['pending', 'failed'].includes(p.status))) {
      return HttpResponse.json(
        { error: { code: 'drawing_set_in_use', message: 'This drawing set cannot be removed because some of its pages have already been processed or added to the project.', details: {}, request_id: 'r' } },
        { status: 409 },
      )
    }
    sets = sets.filter((x) => x !== s)
    return new HttpResponse(null, { status: 204 })
  }),

  // "Run all pages": every page not run yet (pending or failed), through the page route above.
  http.post('*/api/v1/drawing-sets/:id/run-plan/', async ({ params, request }) => {
    const s = sets.find((x) => x.set.id === params.id)!
    const result = { queued: [] as number[], running: [] as number[], skipped: [] as { page: number; reason: string }[] }
    for (const page of [...s.pages].sort((a, b) => a.page_number - b.page_number)) {
      if (page.latest_job && ['queued', 'processing'].includes(page.latest_job.status)) {
        result.running.push(page.page_number)
      } else if (['pending', 'failed'].includes(page.status)) {
        if (page.thumbnail_status !== 'ready') {
          result.skipped.push({ page: page.page_number, reason: 'page_not_ready' })
          continue
        }
        await fetch(new URL(`/api/v1/drawing-pages/${page.id}/run-plan/`, request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: request.headers.get('Authorization') ?? '' },
          body: '{}',
        })
        result.queued.push(page.page_number)
      }
    }
    return HttpResponse.json(result, { status: 202 })
  }),

  http.post('*/api/v1/drawing-pages/:id/run-plan/', async ({ params, request }) => {
    const page = sets.flatMap((s) => s.pages).find((p) => p.id === params.id) as Mutable<DrawingPage>
    if (page.latest_job && ['queued', 'processing'].includes(page.latest_job.status)) {
      return HttpResponse.json({ ...page.latest_job, run: null })
    }
    const body = (await request.json().catch(() => ({}))) as { discard_review?: boolean }
    const reviewed = ((runMembers[page.id] ?? []) as MockMember[]).some((m) => m.review_status !== 'unreviewed' || m.is_corrected)
    if (reviewed && !body.discard_review) {
      return err(409, 'review_in_progress', 'People have already reviewed or corrected members on this page. Running it again replaces the extracted members and their review decisions.')
    }
    const outcome = runOutcomes[page.page_number] ?? 'completed'
    const attempt = ++jobCounter
    const base = {
      id: crypto.randomUUID(),
      page: page.id,
      kind: 'run_plan',
      attempt,
      requested_by: null,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      error_code: '',
      error_message: '',
    }
    // A page's latest_job is a PageJob: the job without its run (the page shows that once, as
    // current_run). The run-plan response is the full ProcessingJob, run included.
    if (outcome === 'stay_processing') {
      page.status = 'processing'
      const job = { ...base, status: 'processing', progress: 40, stage: 'Analysing page content' }
      page.latest_job = job as never
      return HttpResponse.json({ ...job, run: null }, { status: 202 })
    }
    if (outcome === 'failed') {
      page.status = page.current_run ? 'processed' : 'failed'
      const job = {
        ...base,
        status: 'failed',
        progress: 15,
        stage: 'Opening drawing',
        error_code: 'processing_error',
        error_message: 'Processing failed unexpectedly. Nothing was lost. Run Plan again to retry.',
      }
      page.latest_job = job as never
      delete runOutcomes[page.page_number]
      return HttpResponse.json({ ...job, run: null }, { status: 202 })
    }
    const run = {
      id: crypto.randomUUID(),
      status: 'active',
      engine_name: 'page-analysis',
      engine_version: '1.0',
      engine_outdated: false,
      current_engine_version: '1.0',
      page_kind: outcome === 'needs_review' ? 'raster' : 'vector',
      summary: { paths: outcome === 'needs_review' ? 3 : 36986, text_objects: 783, text_chars: outcome === 'needs_review' ? 0 : 5086, images: 1, image_coverage: 0.9, sheet_kind: outcome === 'needs_review' ? 'unknown' : 'plan' },
      review_reasons:
        outcome === 'needs_review'
          ? [{ code: 'scanned_page', message: 'This page appears to be a scanned image rather than a CAD drawing. Automatic extraction from scans is limited, so expect to review it manually.' }]
          : [],
      scale_text: outcome === 'needs_review' ? '' : '1/8" = 1\'-0"',
      scale_ratio: outcome === 'needs_review' ? null : 96,
      scale_confidence: outcome === 'needs_review' ? null : 0.4,
      member_count: outcome === 'needs_review' ? 0 : 3,
      // One column symbol at the right-hand end of the measured W12X26 (450, 95).
      columns:
        outcome === 'needs_review'
          ? []
          : [
              { x: 460, y: 95, shape: 'wide_flange', web_axis: 'y', depth_in: 13.6, flange_in: 12.5 },
              { x: 700, y: 400, shape: 'square_tube', web_axis: null, depth_in: 5, flange_in: 5 },
              { x: 900, y: 400, shape: 'round_tube', web_axis: null, depth_in: 6, flange_in: 6 },
            ],
      // Grid 1 (vertical, through the W12X26's left end) and grid A (horizontal, along it).
      grids:
        outcome === 'needs_review'
          ? []
          : [
              { label: '1', x1: 150, y1: 620, x2: 150, y2: 40, angle: 90, orientation: 'vertical', drawn: true, bubbles: [[150, 620, 9]] },
              { label: 'A', x1: 80, y1: 95, x2: 900, y2: 95, angle: 0, orientation: 'horizontal', drawn: false, bubbles: [[80, 95, 9]] },
            ],
      grid_points: outcome === 'needs_review' ? [] : [{ label: 'A/1', x: 150, y: 95 }],
      // Too few printed dimensions to confirm the scale; one grid spacing printed.
      scale_check:
        outcome === 'needs_review'
          ? null
          : { checked: 3, agree: 3, implied_ratio: 96, implied_text: '1/8" = 1\'-0"', verdict: 'unknown' },
      grid_spacings:
        outcome === 'needs_review' ? null : [{ grids: ['1', '2'], text: "19'-0\"", value_mm: 5791.2, drawn_mm: 5791.2, agrees: true }],
      created_at: new Date().toISOString(),
    }
    runMembers[page.id] =
      outcome === 'needs_review'
        ? []
        : [
            member(page.id, run.id, 'W12X26', 'W', 0),
            {
              ...member(page.id, run.id, 'W12X26', 'W', 1),
              length_mm: '10160.0',
              length_display: "33'-4\"",
              geometry: [[150, 95], [450, 95]],
              confidence: 0.75,
              low_confidence: false,
              warnings: [],
            },
            member(page.id, run.id, 'HSS6X6X1/4', 'HSS', 2, ['unsupported_profile']),
          ]
    for (const m of runMembers[page.id] as MockMember[]) weigh(m)
    runIssues[page.id] =
      outcome === 'needs_review'
        ? [{ id: crypto.randomUUID(), code: 'scanned_page', severity: 'warning', message: 'This page appears to be a scanned image rather than a CAD drawing.', bbox: null, member: null, run: run.id }]
        : [
            { id: crypto.randomUUID(), code: 'length_not_determined', severity: 'warning', message: 'Member labels were found, but their lengths are not measured yet.', bbox: null, member: null, run: run.id },
            { id: crypto.randomUUID(), code: 'scale_ambiguous', severity: 'warning', message: 'This page states more than one scale.', bbox: null, member: null, run: run.id },
          ]
    page.status = 'processed'
    page.current_run = run as never
    const job = { ...base, status: outcome, progress: 100, stage: 'Done' }
    page.latest_job = job as never
    return HttpResponse.json({ ...job, run }, { status: 202 })
  }),

  http.get('*/api/v1/drawing-pages/:id/members/', ({ params }) => HttpResponse.json(runMembers[params.id as string] ?? [])),

  http.post('*/api/v1/drawing-pages/:id/members/', async ({ params, request }) => {
    const page = pageById(params.id as string)!
    if (!['processed', 'added'].includes(page.status)) return err(409, 'page_not_processed', 'Run Plan on this page before reviewing it.')
    const body = (await request.json()) as { designation: string; length?: string; quantity: number; location?: [number, number] | null }
    const length = parseLength(body.length ?? '')
    if (length === 'invalid') return err(400, 'validation_error', 'Some fields are invalid.', { length: ['Use feet and inches (24\'-3"), inches (291"), or millimetres (7391 mm).'] })
    const designation = body.designation.replace(/\s+/g, '').toUpperCase()
    const m: MockMember = {
      ...member(page.id, '', designation, designation.startsWith('HSS') ? 'HSS' : designation[0]!, 99),
      run: null,
      origin: 'manual',
      review_status: 'accepted',
      confidence: 1,
      low_confidence: false,
      warnings: length == null ? ['length_not_determined'] : [],
      length_mm: length as never,
      length_display: display(length),
      quantity: body.quantity,
      label_bbox: body.location ? [body.location[0] - 12, body.location[1] - 6, body.location[0] + 12, body.location[1] + 6] : null,
    } as unknown as MockMember
    weigh(m)
    ;(runMembers[page.id] ??= []).push(m)
    revise(m, 'created', {}, { designation })
    m.version = 1
    return HttpResponse.json(m, { status: 201 })
  }),

  http.patch('*/api/v1/members/:id/', async ({ params, request }) => {
    const found = findMember(params.id as string)!
    const m = found.member
    if (!['processed', 'added'].includes(pageById(found.pageId)!.status)) return err(409, 'page_review_complete', 'This page’s review is complete. Reopen the review to make changes.')
    const body = (await request.json()) as { version: number; designation?: string; member_type?: string; length?: string; quantity?: number; reason?: string }
    if (body.version !== m.version) return err(409, 'stale_version', 'This member was changed by someone else. Reload to see the latest values.')
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (body.designation !== undefined) {
      before.designation = m.designation
      m.designation = body.designation.replace(/\s+/g, '').toUpperCase()
      after.designation = m.designation
      Object.assign(m, sectionFor(m.designation))
    }
    if (body.length !== undefined) {
      const length = parseLength(body.length)
      if (length === 'invalid') return err(400, 'validation_error', 'Some fields are invalid.', { length: ['Use feet and inches (24\'-3"), inches (291"), or millimetres (7391 mm).'] })
      before.length_mm = m.length_mm
      ;(m as { length_mm: unknown }).length_mm = length
      m.length_display = display(length)
      m.warnings = m.warnings.filter((w) => w !== 'length_not_determined').concat(length == null ? ['length_not_determined'] : [])
      after.length_mm = length
    }
    if (body.member_type !== undefined) {
      before.member_type = m.member_type
      m.member_type = body.member_type
      after.member_type = m.member_type
    }
    if (body.quantity !== undefined) {
      before.quantity = m.quantity
      m.quantity = body.quantity
      after.quantity = m.quantity
    }
    m.is_corrected = m.designation !== (m.original as { designation: string }).designation || m.length_mm != null || m.quantity !== 1
    weigh(m)
    revise(m, 'edited', before, after, body.reason)
    return HttpResponse.json(m)
  }),

  http.post('*/api/v1/members/:id/review/', async ({ params, request }) => {
    const found = findMember(params.id as string)!
    const m = found.member
    if (!['processed', 'added'].includes(pageById(found.pageId)!.status)) return err(409, 'page_review_complete', 'This page’s review is complete. Reopen the review to make changes.')
    const body = (await request.json()) as { version: number; status: string; reason?: string }
    if (body.version !== m.version) return err(409, 'stale_version', 'This member was changed by someone else.')
    if (body.status === 'rejected' && !body.reason?.trim()) return err(400, 'validation_error', 'Some fields are invalid.', { reason: ['Say why this member is rejected.'] })
    const before = m.review_status
    ;(m as { review_status: string }).review_status = body.status
    revise(m, 'reviewed', { review_status: before }, { review_status: body.status }, body.reason)
    return HttpResponse.json(m)
  }),

  http.post('*/api/v1/members/:id/restore/', ({ params }) => {
    const m = findMember(params.id as string)!.member
    m.designation = (m.original as { designation: string }).designation
    ;(m as { length_mm: unknown }).length_mm = null
    m.length_display = ''
    m.quantity = 1
    m.is_corrected = false
    revise(m, 'restored', {}, { designation: m.designation })
    return HttpResponse.json(m)
  }),

  http.get('*/api/v1/members/:id/history/', ({ params }) => HttpResponse.json(revisions[params.id as string] ?? [])),

  http.post('*/api/v1/drawing-pages/:id/accept-all/', ({ params }) => {
    const list = (runMembers[params.id as string] ?? []) as MockMember[]
    const open = list.filter((m) => m.review_status === 'unreviewed' && !m.warnings.includes('unsupported_profile'))
    for (const m of open) {
      ;(m as { review_status: string }).review_status = 'accepted'
      revise(m, 'reviewed', { review_status: 'unreviewed' }, { review_status: 'accepted' })
    }
    return HttpResponse.json({ accepted: open.length })
  }),

  http.post('*/api/v1/drawing-pages/:id/mark-reviewed/', ({ params }) => {
    const page = pageById(params.id as string)!
    const open = ((runMembers[page.id] ?? []) as MockMember[]).filter((m) => ['unreviewed', 'needs_review'].includes(m.review_status)).length
    if (open) return err(409, 'review_incomplete', `${open} member(s) still need a decision.`, { open })
    page.status = 'reviewed'
    return HttpResponse.json(page)
  }),

  http.post('*/api/v1/drawing-pages/:id/reopen-review/', ({ params }) => {
    const page = pageById(params.id as string)!
    page.status = 'processed'
    return HttpResponse.json(page)
  }),
  http.post('*/api/v1/drawing-pages/:id/add-to-project/', ({ params }) => {
    const page = pageById(params.id as string)!
    if (page.status !== 'reviewed' && page.status !== 'added') return err(409, 'page_not_reviewed', 'Mark the page reviewed before adding it to the project.')
    page.status = 'added'
    return HttpResponse.json(page)
  }),
  http.post('*/api/v1/drawing-pages/:id/remove-from-project/', ({ params }) => {
    const page = pageById(params.id as string)!
    const open = ((runMembers[page.id] ?? []) as MockMember[]).some((m) => ['unreviewed', 'needs_review'].includes(m.review_status))
    page.status = open ? 'processed' : 'reviewed'
    return HttpResponse.json(page)
  }),
  http.get('*/api/v1/members/:id/', ({ params }) => {
    const found = findMember(params.id as string)
    return found ? HttpResponse.json(found.member) : err(404, 'not_found', 'Member not found.')
  }),
  http.get('*/api/v1/projects/:id/abm/summary/', ({ params, request }) => {
    const draft = new URL(request.url).searchParams.get('draft') === 'true'
    const all = abmMembers(params.id as string, true, draft)
    const entries = all.filter((e) => e.review_status !== 'rejected')
    const count = (pred: (e: AbmMock) => boolean) => entries.filter(pred).length
    const profiles = new Map<string, { profile: string; entries: number; quantity: number }>()
    for (const e of entries) {
      const g = profiles.get(e.profile) ?? { profile: e.profile, entries: 0, quantity: 0 }
      g.entries += 1
      g.quantity += e.quantity
      profiles.set(e.profile, g)
    }
    const projectPages = sets.filter((x) => x.set.project === params.id).flatMap((x) => x.pages.map((p) => ({ p, x })))
    return HttpResponse.json({
      entries: entries.length,
      quantity: entries.reduce((n, e) => n + e.quantity, 0),
      accepted: count((e) => e.review_status === 'accepted'),
      open: count((e) => ['unreviewed', 'needs_review'].includes(e.review_status)),
      unsupported: count((e) => e.review_status === 'unsupported'),
      rejected: all.length - entries.length,
      corrected: count((e) => e.source === 'corrected'),
      manual: count((e) => e.source === 'manual'),
      match_status: {},
      profiles: [...profiles.values()].sort((a, b) => b.quantity - a.quantity),
      designations: [],
      pages: projectPages
        .filter(({ p }) => (draft ? DRAFT_STATES.includes(p.status) : p.status === 'added'))
        .map(({ p, x }) => ({
          id: p.id,
          page_number: p.page_number,
          drawing_set: { id: x.set.id, original_filename: x.set.original_filename },
          entries: entries.filter((e) => e.page === p.id).length,
          quantity: entries.filter((e) => e.page === p.id).reduce((n, e) => n + e.quantity, 0),
          open: 0,
        })),
      pages_processed: projectPages.filter(({ p }) => p.status === 'processed').length,
      pages_reviewed: projectPages.filter(({ p }) => p.status === 'reviewed').length,
    })
  }),
  http.patch('*/api/v1/drawing-pages/:id/level/', async ({ params, request }) => {
    const page = pageById(params.id as string)!
    if (!['processed', 'reviewed', 'added'].includes(page.status)) return err(409, 'page_not_processed', 'Run Plan on this page before setting its level.')
    const body = (await request.json()) as { level_label?: string; elevation?: string; reference_point?: [number, number] | null; reference_label?: string }
    const p = page as unknown as Record<string, unknown>
    if (body.elevation !== undefined) {
      const zero = /^-?\s*0+\s*('|mm)?$/.test(body.elevation.trim())
      const length = zero ? 0 : parseLength(body.elevation)
      if (length === 'invalid') return err(400, 'validation_error', 'Some fields are invalid.', { elevation: ['Use feet and inches (24\'-3"), inches (291"), or millimetres (7391 mm).'] })
      p.elevation_mm = length == null ? null : length.toFixed(1)
      p.elevation_display = length == null ? '' : display(length)
    }
    if (body.level_label !== undefined) p.level_label = body.level_label
    if (body.reference_label !== undefined) p.reference_label = body.reference_label
    if (body.reference_point !== undefined) p.reference_point = body.reference_point
    return HttpResponse.json(page)
  }),
  http.get('*/api/v1/projects/:id/wireframe-setup/', ({ params }) => {
    const rows = sets
      .filter((x) => x.set.project === params.id)
      .flatMap((x) =>
        x.pages
          .filter((p) => p.status === 'added')
          .map((p) => ({
            id: p.id,
            page_number: p.page_number,
            original_filename: x.set.original_filename,
            level_label: p.level_label,
            elevation_mm: p.elevation_mm,
            elevation_display: p.elevation_display,
            reference_label: p.reference_label,
            has_reference_point: Boolean(p.reference_point),
            scale_ratio: p.current_run?.scale_ratio ?? null,
            columns: p.current_run?.columns?.length ?? null,
            missing: setupOf(p),
            sheet_kind: sheetKinds[p.id] ?? 'plan',
            placed_in_3d: isPlan(p),
          })),
      )
    return HttpResponse.json({ pages: rows, ready: rows.length > 0 && rows.every((r) => !r.missing.length) })
  }),
  // Level proposals: every processed page reads as LEVEL 2 at 14'-0", reference A/1 (150, 95).
  http.get('*/api/v1/projects/:id/level-proposals/', ({ params }) => HttpResponse.json(levelProposals(params.id as string))),
  http.post('*/api/v1/projects/:id/level-proposals/apply/', async ({ params, request }) => {
    const { pages } = (await request.json()) as { pages: string[] }
    const rows = levelProposals(params.id as string).pages.filter((r) => pages.includes(r.page_id))
    for (const r of rows) {
      const p = pageById(r.page_id) as unknown as Record<string, unknown>
      Object.assign(p, { level_label: r.level_label, elevation_mm: r.elevation_mm, elevation_display: r.elevation_display, reference_point: r.reference_point, reference_label: r.reference_label })
    }
    return HttpResponse.json({ applied: rows.length })
  }),
  // Column schedule: each added page with a level is one level; its column symbols are the
  // columns (the first one at grid A/1), symbols only until "Add to the ABM".
  http.get('*/api/v1/projects/:id/column-schedule/', ({ params }) => HttpResponse.json(columnSchedule(params.id as string))),
  http.post('*/api/v1/projects/:id/column-schedule/sync/', ({ params }) => {
    const created = columnSchedule(params.id as string).not_in_bill
    syncedProjects.add(params.id as string)
    return HttpResponse.json({ heights_updated: 0, entries_created: created })
  }),
  http.get('*/api/v1/projects/:id/wireframes/', ({ params }) =>
    HttpResponse.json(wireframes.filter((w) => w.project === params.id).map(wireframeOut).reverse()),
  ),
  http.patch('*/api/v1/wireframe-elements/:id/', async ({ params, request }) => {
    const found = findElement(params.id as string)!
    if (found.w.status !== 'draft') return err(409, 'wireframe_not_editable', 'This revision is saved as reviewed and can no longer change.')
    const body = (await request.json()) as Record<string, unknown>
    if (body.version !== found.e.version) return err(409, 'stale_version', 'This element was changed by someone else.')
    try {
      for (const key of ['start', 'end'] as const) if (body[key]) found.e[key] = (body[key] as unknown[]).map(coordinate)
    } catch {
      return err(400, 'validation_error', 'Some fields are invalid.', { end: ['Use feet and inches or millimetres.'] })
    }
    for (const key of ['element_type', 'designation', 'level_label']) if (body[key] !== undefined) found.e[key] = key === 'designation' ? String(body[key]).toUpperCase() : body[key]
    if (found.e.start && found.e.end) found.e.completeness = 'ok'
    if (found.e.provenance === 'generated') found.e.provenance = 'edited'
    found.e.version = (found.e.version as number) + 1
    return HttpResponse.json(found.e)
  }),
  http.delete('*/api/v1/wireframe-elements/:id/', ({ params }) => {
    const found = findElement(params.id as string)!
    found.e.removed = true
    return new HttpResponse(null, { status: 204 })
  }),
  http.post('*/api/v1/wireframes/:id/elements/', async ({ params, request }) => {
    const w = wireframes.find((x) => x.id === params.id)!
    const body = (await request.json()) as Record<string, unknown>
    let start: string[], end: string[]
    try {
      start = (body.start as unknown[]).map(coordinate)
      end = (body.end as unknown[]).map(coordinate)
    } catch {
      return err(400, 'validation_error', 'Some fields are invalid.', { end: ['Use feet and inches or millimetres.'] })
    }
    const e = {
      id: crypto.randomUUID(),
      element_type: body.element_type,
      designation: String(body.designation ?? '').toUpperCase(),
      profile: '',
      quantity: 1,
      level_label: body.level_label ?? '',
      start,
      end,
      length_mm: null,
      length_display: '',
      provenance: 'added',
      completeness: 'ok',
      issues: ['placed_by_hand'],
      issue_messages: ['Placed or moved by a person.'],
      details: {},
      source_member: null,
      source_page: null,
      page_number: null,
      version: 1,
    }
    w.elements.push(e)
    return HttpResponse.json(e, { status: 201 })
  }),
  http.post('*/api/v1/wireframes/:id/mark-reviewed/', ({ params }) => {
    const w = wireframes.find((x) => x.id === params.id)!
    const c = countsOf(w)
    Object.assign(w, {
      status: 'reviewed',
      reviewed_at: new Date().toISOString(),
      reviewed_by: 'Esha Estimator',
      remaining_work: { not_placed: c.by_completeness.missing_data, unsupported: c.by_completeness.unsupported, columns_without_size: c.columns_without_size },
    })
    return HttpResponse.json(wireframeOut(w))
  }),
  http.post('*/api/v1/wireframes/:id/copy/', ({ params }) => {
    const source = wireframes.find((x) => x.id === params.id)!
    const copy: MockWireframe = {
      ...source,
      id: crypto.randomUUID(),
      revision_no: wireframes.filter((x) => x.project === source.project).length + 1,
      status: 'draft',
      reviewed_at: null,
      reviewed_by: null,
      remaining_work: {},
      copied_from_revision: source.revision_no,
      elements: source.elements.filter((e) => !e.removed).map((e) => ({ ...e, id: crypto.randomUUID(), version: 1 })),
    }
    wireframes.push(copy)
    return HttpResponse.json(wireframeOut(copy), { status: 201 })
  }),
  http.post('*/api/v1/projects/:id/wireframes/', ({ params }) => {
    const pages = sets.filter((x) => x.set.project === params.id).flatMap((x) => x.pages.filter((p) => p.status === 'added'))
    if (!pages.length) return err(409, 'no_pages_added', 'Add at least one reviewed page to the project before generating a wireframe.')
    return HttpResponse.json(wireframeOut(generateMock(params.id as string, 'Esha Estimator')), { status: 202 })
  }),
  http.get('*/api/v1/wireframes/:id/elements/', ({ params }) =>
    HttpResponse.json(wireframes.find((w) => w.id === params.id)?.elements.filter((e) => !e.removed) ?? []),
  ),
  // Find similar on the page: 3 columns like the one pointed at.
  http.post('*/api/v1/drawing-pages/:id/find-similar-columns/', ({ params }) => {
    const page = sets.flatMap((x) => x.pages).find((p) => p.id === params.id)
    if (!page) return err(404, 'not_found', 'Page not found.')
    return HttpResponse.json({ added: 3, pages: [{ page_id: page.id, page_number: page.page_number, added: 3 }], template: { width_pt: 6, height_pt: 3 } })
  }),
  // Find similar on every plan of the set, as a job. Each poll moves it on by one plan: queued,
  // then one plan searched per poll, then completed (5 more columns, on page 2).
  http.post('*/api/v1/drawing-pages/:id/find-similar-columns/jobs/', async ({ params, request }) => {
    const body = (await request.json()) as { point: [number, number] }
    const owner = sets.find((x) => x.pages.some((p) => p.id === params.id))
    const page = owner?.pages.find((p) => p.id === params.id)
    if (!owner || !page) return err(404, 'not_found', 'Page not found.')
    if (!page.current_run) return err(409, 'page_not_run', 'Run this page first.')
    const running = Object.values(similarJobs).find((j) => j.drawing_set === owner.set.id && ['queued', 'processing'].includes(j.status as string))
    if (running) {
      return HttpResponse.json(
        { error: { code: 'similar_search_running', message: 'A search of this drawing set is already running.', details: { job_id: running.id }, request_id: 'r' } },
        { status: 409 },
      )
    }
    const job = {
      id: crypto.randomUUID(),
      page: page.id,
      drawing_set: owner.set.id,
      point: body.point,
      status: 'queued',
      progress: 0,
      stage: 'Queued',
      pages_total: owner.pages.length,
      pages_done: 0,
      result: null,
      error_code: '',
      error_message: '',
      requested_by: null,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
    }
    similarJobs[job.id] = job
    return HttpResponse.json(job, { status: 202 })
  }),
  http.get('*/api/v1/similar-columns-jobs/:id/', ({ params }) => {
    const job = similarJobs[params.id as string]
    if (!job) return err(404, 'not_found', 'Not found.')
    const total = job.pages_total as number
    if (['queued', 'processing'].includes(job.status as string)) {
      const done = job.status === 'queued' ? 0 : (job.pages_done as number) + 1
      const page2 = sets.find((x) => x.set.id === job.drawing_set)?.pages[1]
      const result = { added: 5, pages: [{ page_id: page2?.id ?? job.page, page_number: 2, added: 5 }], template: { width_pt: 6, height_pt: 3 } }
      Object.assign(
        job,
        done >= total
          ? { status: 'completed', progress: 100, stage: 'Done', pages_done: total, result, finished_at: new Date().toISOString() }
          : { status: 'processing', progress: Math.round((done / total) * 100), stage: `Searched ${done} of ${total} plans`, pages_done: done, result: done >= 2 ? result : null },
      )
    }
    return HttpResponse.json(job)
  }),
  // Column Scheduler: tested on its own (ColumnScheduler.test.tsx); the page only needs a list.
  http.get('*/api/v1/wireframes/:id/columns/', () => HttpResponse.json({ levels: [], columns: [] })),
  http.get('*/api/v1/ops/metrics/', () =>
    HttpResponse.json({
      days: 30,
      events: [{ key: 'drawing_uploaded', label: 'Drawing uploaded', count: 4 }, { key: 'member_corrected', label: 'Member corrected', count: 14 }],
      north_star: { median_hours_upload_to_abm_started: 3.5, median_hours_upload_to_finalised: 52, median_hours_upload_to_reviewed_wireframe: null, projects_measured: 1 },
      completion: { projects_started: 2, projects_finalised: 1, rate: 0.5, target: 0.85 },
      review: { median_minutes_run_to_page_reviewed: 18.5 },
      quality: { members_extracted: 973, corrections_per_100_members: 1.4, rejections_per_100_members: 0.2, extraction_failure_rate: 0.05, processing_coverage: 0.95, processing_coverage_target: 0.9 },
      weeks: [{ week_start: '2026-09-29', uploads: 4, pages_processed: 22, corrections: 14, finalised: 1 }],
      notes: ['The 50% / 70% time-saving goals need the baseline time study (B-4) to compare with.'],
    }),
  ),
  http.get('*/api/v1/ops/overview/', () =>
    HttpResponse.json({
      healthy: true,
      checks: { database: 'ok', storage: 'ok', redis: 'ok' },
      jobs_24h: { queued: 0, processing: 0, completed: 3, needs_review: 1, failed: 1 },
      active_jobs: 0,
      oldest_active_seconds: null,
      average_run_seconds_7d: 12.4,
      failures_7d: [{ error_code: 'processing_error', n: 1 }],
      wireframes: { generating: 0, failed_7d: 0 },
      engines: [{ engine_name: 'vector-labels', engine_version: '0.3', pages: 22 }],
      corrections_7d: 14,
      rejections_7d: 2,
    }),
  ),
  http.get('*/api/v1/ops/jobs/', ({ request }) => {
    const status = new URL(request.url).searchParams.get('status')
    const rows = [
      { id: 'j1', status: 'completed', stage: 'Done', progress: 100, attempt: 1, error_code: '', error_message: '', project: { id: 'p1', name: 'Warehouse' }, page: { id: 'pg1', page_number: 3, original_filename: 'GA.pdf' }, requested_by: 'Esha Estimator', created_at: '2026-10-06T09:00:00Z', started_at: '2026-10-06T09:00:01Z', finished_at: '2026-10-06T09:00:13Z', duration_seconds: 12.0, run: { engine: 'vector-labels 0.3', members: 151, scale: '1/8" = 1\'-0"', columns: 28, status: 'active' } },
      { id: 'j2', status: 'failed', stage: 'Opening drawing', progress: 15, attempt: 2, error_code: 'processing_error', error_message: 'Processing failed unexpectedly.', project: { id: 'p1', name: 'Warehouse' }, page: { id: 'pg2', page_number: 9, original_filename: 'old.pdf' }, requested_by: 'Esha Estimator', created_at: '2026-10-06T08:00:00Z', started_at: '2026-10-06T08:00:01Z', finished_at: '2026-10-06T08:00:02Z', duration_seconds: 1.0, run: null },
    ].filter((r) => !status || r.status === status)
    return HttpResponse.json({ count: rows.length, next: null, previous: null, results: rows })
  }),
  http.get('*/api/v1/ops/audit/', () =>
    HttpResponse.json({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 'a1', occurred_at: '2026-10-06T09:30:00Z', action: 'member.edited', actor: 'Esha Estimator', actor_type: 'user', entity_type: 'member', entity_id: 'm1', project: { id: 'p1', name: 'Warehouse' }, before: { quantity: 1 }, after: { quantity: 2 }, reason: 'Two bays', request_id: 'r1' }],
    }),
  ),
  http.get('*/api/v1/projects/:id/finalize/', ({ params }) => HttpResponse.json(checkFor(params.id as string))),
  http.post('*/api/v1/projects/:id/finalize/', async ({ params, request }) => {
    const id = params.id as string
    const body = (await request.json()) as { acknowledge_exceptions?: boolean; note?: string }
    const check = checkFor(id)
    if (check.status === 'finalized') return err(409, 'already_finalized', 'This project is already finalised.')
    if (check.blocking.length) return err(409, check.blocking[0]!.code, check.blocking[0]!.message)
    if (check.requires_acknowledgement && !body.acknowledge_exceptions)
      return err(409, 'acknowledgement_required', 'This project has unresolved exceptions. Confirm that you accept them to finalise.', { exceptions: check.exceptions })
    for (const v of versions) if (v.project === id) v.is_current = false
    const version: MockVersion = {
      id: crypto.randomUUID(),
      project: id,
      version_no: check.next_version,
      created_at: new Date().toISOString(),
      finalized_by: 'Esha Estimator',
      note: body.note ?? '',
      exceptions: check.exceptions,
      exceptions_acknowledged: check.exceptions.length > 0,
      summary: { entries: check.abm.entries, reviewed: check.tonnage.reviewed, complete: !check.exceptions.length, wireframe_revision: check.wireframe?.revision_no ?? null },
      snapshot_sha256: 'abc',
      snapshot_bytes: 100,
      reopened_at: null,
      reopened_by: null,
      reopen_reason: '',
      is_current: true,
    }
    versions.push(version)
    const project = mockProjects.all.find((p) => p.id === id)!
    project.status = 'finalized'
    project.finalized_at = version.created_at
    const { project: _p, ...out } = version
    return HttpResponse.json(out, { status: 201 })
  }),
  http.post('*/api/v1/projects/:id/reopen/', async ({ params, request }) => {
    const body = (await request.json()) as { reason?: string }
    if (!body.reason?.trim()) return err(400, 'validation_error', 'Some fields are invalid.', { reason: ['Say why the project is reopened.'] })
    const project = mockProjects.all.find((p) => p.id === params.id)!
    project.status = 'active'
    project.finalized_at = null
    const current = versions.filter((v) => v.project === params.id).at(-1)
    if (current) Object.assign(current, { is_current: false, reopened_at: new Date().toISOString(), reopened_by: 'Esha Estimator', reopen_reason: body.reason })
    return new HttpResponse(null, { status: 204 })
  }),
  http.get('*/api/v1/projects/:id/outputs/', ({ params }) =>
    HttpResponse.json(versions.filter((v) => v.project === params.id).map(({ project: _p, ...v }) => v).reverse()),
  ),
  // Like the real endpoint: only these formats (anything else is a 404 there).
  http.get('*/api/v1/outputs/:id/download/', ({ request }) => {
    const format = new URL(request.url).searchParams.get('format') ?? 'xlsx'
    if (!['xlsx', 'json', 'ifc'].includes(format)) return err(404, 'not_found', 'Not found.')
    return new HttpResponse(new Uint8Array([80, 75, 3, 4]).buffer, { headers: { 'Content-Type': 'application/octet-stream' } })
  }),
  http.get('*/api/v1/projects/:id/summary/', ({ params }) => HttpResponse.json(summaryFor(params.id as string))),
  http.get('*/api/v1/projects/:id/history/', ({ params, request }) => {
    const q = new URL(request.url).searchParams
    const all = historyFor(params.id as string).filter((i) => !q.get('category') || i.category === q.get('category'))
    const before = q.get('before')
    const list = before ? all.filter((i) => i.occurred_at < before) : all
    const limit = Number(q.get('limit') ?? 50)
    const page = list.slice(0, limit)
    return HttpResponse.json({ results: page, next_before: list.length > limit ? page[page.length - 1]!.occurred_at : null })
  }),
  // Beams known by a mark only: none unless a test sets them (mockDrawings.beamMarks).
  http.get('*/api/v1/projects/:id/abm/marks/', () => HttpResponse.json(beamMarks)),
  http.post('*/api/v1/projects/:id/abm/marks/assign/', async ({ request }) => {
    const body = (await request.json()) as { mark: string; designation: string }
    const row = beamMarks.find((m) => m.mark === body.mark)
    if (row) row.sections = [body.designation.toUpperCase()]
    return HttpResponse.json({ mark: body.mark, updated: row?.beams ?? 0, locked: 0 })
  }),
  http.get('*/api/v1/projects/:id/abm/totals/', ({ params, request }) => {
    const entries = abmMembers(params.id as string, false, new URL(request.url).searchParams.get('draft') === 'true')
    const lb = (list: AbmMock[]) => list.reduce((n, e) => n + (e.weight ? Number(e.weight.lb) : 0), 0)
    const reviewed = entries.filter((e) => e.weight && e.review_status === 'accepted')
    const incomplete = entries.filter((e) => e.weight && e.review_status !== 'accepted')
    const unsupported = entries.filter((e) => !e.weight && e.match_status === 'unsupported')
    const noSection = entries.filter((e) => !e.weight && e.match_status !== 'unsupported' && !e.section)
    const noLength = entries.filter((e) => !e.weight && e.match_status !== 'unsupported' && e.section)
    const count = (list: AbmMock[]) => ({ entries: list.length, quantity: list.reduce((n, e) => n + e.quantity, 0) })
    const designations = [...new Set(entries.map((e) => e.designation))].sort()
    return HttpResponse.json({
      units: { length: 'feet-inches', weight: 'lb and kg', tonnage: 'US tons (2,000 lb) and metric tonnes (1,000 kg)', unit_weight: 'lb/ft and kg/m' },
      section_dataset: 'AISC Shapes Database v16.0',
      reviewed: { ...count(reviewed), weight: amounts(lb(reviewed)) },
      incomplete: { ...count(incomplete), weight: amounts(lb(incomplete)), reasons: { awaiting_review: incomplete.length } },
      not_weighed: {
        ...count([...unsupported, ...noSection, ...noLength]),
        reasons: { no_length: count(noLength), not_in_section_data: count(noSection), unsupported: count(unsupported) },
      },
      not_in_tonnage: { entries: 0, quantity: 0, length_mm: null, families: ['K', 'KCS', 'LH', 'DLH', 'JG'] },
      estimate_all_weighed: amounts(lb(reviewed) + lb(incomplete)),
      connection_material: { lines: connectionLines.length, weight: amounts(connectionLb()), unweighed: connectionLines.filter((l) => !l.weight).length },
      estimate_with_connections: amounts(lb(reviewed) + lb(incomplete) + connectionLb()),
      complete: incomplete.length + unsupported.length + noSection.length + noLength.length === 0,
      groups: designations.map((d) => {
        const list = entries.filter((e) => e.designation === d)
        const r = list.filter((e) => reviewed.includes(e))
        const i = list.filter((e) => incomplete.includes(e))
        const measured = list.filter((e) => e.length_mm != null)
        return {
          profile: list[0]!.profile,
          designation: d,
          ...count(list),
          measured_length_mm: measured.length ? measured.reduce((n, e) => n + Number(e.length_mm) * e.quantity, 0).toFixed(1) : null,
          unmeasured: list.filter((e) => e.length_mm == null).reduce((n, e) => n + e.quantity, 0),
          unit_weight_lb_per_ft: list[0]!.section?.weight_lb_per_ft ?? null,
          unit_weight_kg_per_m: list[0]!.section?.weight_kg_per_m ?? null,
          reviewed: r.length ? amounts(lb(r)) : null,
          incomplete: i.length ? amounts(lb(i)) : null,
          weighed: r.length + i.length ? amounts(lb(r) + lb(i)) : null,
          not_weighed: list.length - r.length - i.length,
          counted_in_tonnage: true,
        }
      }),
    })
  }),
  http.get('*/api/v1/projects/:id/abm/', ({ params, request }) => {
    const q = new URL(request.url).searchParams
    const statuses = q.get('review_status')?.split(',')
    let list = abmMembers(params.id as string, q.get('include_rejected') === 'true', q.get('draft') === 'true')
    if (q.get('search')) list = list.filter((e) => e.designation.includes(q.get('search')!.toUpperCase().replace(/\s+/g, '')))
    if (q.get('designation')) list = list.filter((e) => e.designation === q.get('designation'))
    if (q.get('match_status')) list = list.filter((e) => q.get('match_status')!.split(',').includes(e.match_status))
    if (q.get('length_missing') === 'true') list = list.filter((e) => e.length_mm == null)
    if (q.get('profile')) list = list.filter((e) => q.get('profile')!.split(',').includes(e.profile))
    if (q.get('page')) list = list.filter((e) => e.page === q.get('page'))
    if (statuses) list = list.filter((e) => statuses.includes(e.review_status))
    if (q.get('source')) list = list.filter((e) => e.source === q.get('source'))
    if (q.get('length_min')) {
      const min = parseLength(q.get('length_min')!)
      if (min === 'invalid') return err(400, 'validation_error', 'Some filters are invalid.', { length_min: ['Use feet and inches (24\'-3"), inches (291"), or millimetres (7391 mm).'] })
      list = list.filter((e) => e.length_mm != null && Number(e.length_mm) >= (min ?? 0))
    }
    const ordering = q.get('ordering') ?? 'page'
    if (ordering.endsWith('designation')) {
      list = [...list].sort((a, b) => a.designation.localeCompare(b.designation))
      if (ordering.startsWith('-')) list.reverse()
    }
    const limit = Number(q.get('limit') ?? 50)
    const offset = Number(q.get('offset') ?? 0)
    return HttpResponse.json({ count: list.length, next: offset + limit < list.length ? 'next' : null, previous: null, results: list.slice(offset, offset + limit) })
  }),
  http.get('*/api/v1/drawing-pages/:id/issues/', ({ params }) => HttpResponse.json(runIssues[params.id as string] ?? [])),

  http.get('*/api/v1/section-datasets/', () =>
    HttpResponse.json([
      { id: 'ds-1', name: 'AISC Shapes Database', version: '16.0', label: 'AISC Shapes Database v16.0', source: '', original_filename: 'aisc-shapes-database-v16.0.xlsx', checksum: 'x', unit_system: 'imperial', status: 'approved', is_default: true, is_test: false, profile_count: 2299, created_at: '2026-10-06T09:00:00Z', approved_at: '2026-10-06T09:05:00Z' },
      { id: 'ds-0', name: 'AISC Shapes Database', version: '15.0', label: 'AISC Shapes Database v15.0', source: '', original_filename: 'v15.0.xlsx', checksum: 'z', unit_system: 'imperial', status: 'approved', is_default: false, is_test: false, profile_count: 2200, created_at: '2026-09-01T10:00:00Z', approved_at: '2026-09-01T10:05:00Z' },
      { id: 'ds-2', name: 'AISC Shapes Database', version: '16.1', label: 'AISC Shapes Database v16.1', source: '', original_filename: 'v16.1.xlsx', checksum: 'y', unit_system: 'imperial', status: 'draft', is_default: false, is_test: false, profile_count: 2310, created_at: '2026-10-06T10:00:00Z', approved_at: null },
    ]),
  ),
  http.get('*/api/v1/section-datasets/:id/profiles/', ({ request }) => {
    const search = new URL(request.url).searchParams.get('search')?.toUpperCase() ?? ''
    return HttpResponse.json(
      Object.entries(CATALOGUE)
        .filter(([d]) => d.startsWith(search))
        .map(([d, [lb, kg]]) => ({ id: `p-${d}`, designation: d, family: 'W', weight_lb_per_ft: lb, weight_kg_per_m: kg, properties: {} })),
    )
  }),
  http.post('*/api/v1/section-datasets/:id/approve/', ({ params }) =>
    HttpResponse.json({ id: params.id, label: 'AISC Shapes Database v16.1', status: 'approved', is_default: true }),
  ),

  http.get('*/api/v1/drawing-pages/:id/thumbnail/', () =>
    new HttpResponse(new Blob(['RIFF'], { type: 'image/webp' }), { headers: { 'Content-Type': 'image/webp' } }),
  ),
]

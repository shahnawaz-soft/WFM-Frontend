import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { getOpsMetrics, getOpsOverview, listOpsAudit, listOpsJobs } from '../../api/ops'
import { ErrorState, LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { SelectField, TextField } from '../../components/ui/Field'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { StatusTone } from '../../components/ui/StatusIcon'
import { useDebouncedValue } from '../../lib/useDebouncedValue'

const PAGE = 50
const JOB_TONE: Record<string, StatusTone> = {
  queued: 'neutral',
  processing: 'info',
  completed: 'success',
  needs_review: 'warning',
  failed: 'error',
}
const JOB_LABEL: Record<string, string> = {
  queued: 'Queued',
  processing: 'Processing',
  completed: 'Completed',
  needs_review: 'Needs review',
  failed: 'Failed',
}
type Tab = 'overview' | 'jobs' | 'audit' | 'metrics'

const seconds = (s: number | null) => (s == null ? '—' : s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`)
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—')

/** Operator screens (operators and administrators): health, jobs and failures, audit. */
export function OpsPage() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'overview'
  const setTab = (t: Tab) => setParams((p) => ({ ...Object.fromEntries(p), tab: t }), { replace: true })
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Operations</h1>
          <p className="muted">Processing health, jobs and failures, and the audit log across all projects.</p>
        </div>
      </div>
      <div className="family-tabs ops-tabs" role="group" aria-label="Show">
        {(
          [
            ['overview', 'Overview'],
            ['jobs', 'Jobs'],
            ['audit', 'Audit log'],
            ['metrics', 'Metrics'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview onShowFailures={() => setParams({ tab: 'jobs', status: 'failed' })} />}
      {tab === 'jobs' && <Jobs initialStatus={params.get('status') ?? ''} />}
      {tab === 'audit' && <Audit />}
      {tab === 'metrics' && <Metrics />}
    </>
  )
}

function Overview({ onShowFailures }: { onShowFailures: () => void }) {
  const overview = useQuery({ queryKey: ['ops', 'overview'], queryFn: getOpsOverview, refetchInterval: 15_000 })
  if (overview.error) return <ErrorState title="Could not load the overview" error={overview.error} />
  const o = overview.data
  if (!o) return <LoadingState label="Loading…" />
  const failed = o.jobs_24h.failed ?? 0
  return (
    <div className="ops-grid">
      <section className="card" aria-labelledby="ops-health">
        <h2 id="ops-health">Health</h2>
        <p>
          <StatusBadge tone={o.healthy ? 'success' : 'error'} label={o.healthy ? 'All services up' : 'A service is down'} />
        </p>
        <dl className="facts">
          {Object.entries(o.checks).map(([name, state]) => (
            <div key={name} className="facts__row">
              <dt>{name}</dt>
              <dd>{state === 'ok' ? 'OK' : 'Error (see the logs)'}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="card" aria-labelledby="ops-jobs">
        <h2 id="ops-jobs">Run Plan, last 24 hours</h2>
        <dl className="abm-stats" aria-label="Jobs in the last 24 hours">
          {Object.entries(JOB_LABEL).map(([status, label]) => (
            <div key={status} data-attention={status === 'failed' && (o.jobs_24h[status] ?? 0) > 0 ? true : undefined}>
              <dt>{label}</dt>
              <dd>{o.jobs_24h[status] ?? 0}</dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          Running or waiting now: {o.active_jobs}
          {o.oldest_active_seconds != null && ` (oldest ${seconds(o.oldest_active_seconds)})`} · average run (7 days):{' '}
          {seconds(o.average_run_seconds_7d)}
        </p>
        {failed > 0 && <Button onClick={onShowFailures}>Show failed jobs</Button>}
      </section>
      <section className="card" aria-labelledby="ops-failures">
        <h2 id="ops-failures">Failures, last 7 days</h2>
        {o.failures_7d.length === 0 ? (
          <p className="review-card__ok">✓ None.</p>
        ) : (
          <ul className="review-card__list" aria-label="Failures by reason">
            {o.failures_7d.map((f) => (
              <li key={f.error_code}>
                <code>{f.error_code}</code>: {f.n}
              </li>
            ))}
          </ul>
        )}
        <p className="muted">
          Wireframes generating: {o.wireframes.generating} · failed (7 days): {o.wireframes.failed_7d}
        </p>
      </section>
      <section className="card" aria-labelledby="ops-quality">
        <h2 id="ops-quality">Corrections, last 7 days</h2>
        <p>
          {o.corrections_7d} member corrections · {o.rejections_7d} rejections
        </p>
        <h3>Extraction engines in use</h3>
        <ul className="review-card__list">
          {o.engines.map((e) => (
            <li key={`${e.engine_name}${e.engine_version}`}>
              {e.engine_name} {e.engine_version}: {e.pages} pages
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function Jobs({ initialStatus }: { initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus)
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const debounced = useDebouncedValue(search, 300)
  const jobs = useQuery({
    queryKey: ['ops', 'jobs', status, debounced, offset],
    queryFn: () => listOpsJobs({ status, search: debounced, offset, limit: PAGE }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  })
  return (
    <section className="card" aria-label="Jobs">
      <div className="filters">
        <SelectField
          label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setOffset(0)
          }}
          options={[{ value: '', label: 'All' }, ...Object.entries(JOB_LABEL).map(([value, label]) => ({ value, label }))]}
        />
        <TextField label="Search" type="search" placeholder="Project or file name" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {jobs.error && <ErrorState title="Could not load jobs" error={jobs.error} />}
      {jobs.data && jobs.data.count === 0 && <p className="muted">No jobs.</p>}
      {jobs.data && jobs.data.count > 0 && (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">Processing jobs, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Project / page</th>
                <th scope="col">Status</th>
                <th scope="col">Took</th>
                <th scope="col">Result</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {jobs.data.results.map((j) => {
                const project = j.project as { id: string; name: string }
                const page = j.page as { id: string; page_number: number; original_filename: string }
                const run = j.run as { engine: string; members: number; scale: string; columns: number | null } | null
                return (
                  <tr key={j.id}>
                    <td className="nowrap">{when(j.started_at ?? j.created_at)}</td>
                    <td>
                      <Link to={`/projects/${project.id}/pages/${page.id}`}>
                        {project.name} · p.{page.page_number} {page.original_filename}
                      </Link>
                    </td>
                    <td className="nowrap">
                      <StatusBadge tone={JOB_TONE[j.status] ?? 'neutral'} label={JOB_LABEL[j.status] ?? j.status} />
                      {j.attempt > 1 && <span className="muted"> · attempt {j.attempt}</span>}
                    </td>
                    <td className="nowrap">{seconds(j.duration_seconds)}</td>
                    <td>
                      {j.status === 'failed' ? (
                        <span className="field__error">
                          <code>{j.error_code}</code> {j.error_message}
                        </span>
                      ) : run ? (
                        `${run.members} members${run.columns != null ? `, ${run.columns} columns` : ''}${run.scale ? `, ${run.scale}` : ''} · ${run.engine}`
                      ) : (
                        j.stage
                      )}
                    </td>
                    <td>{j.requested_by ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {jobs.data && jobs.data.count > PAGE && (
        <nav className="pagination" aria-label="Pages of jobs">
          <span className="muted">
            {offset + 1}–{Math.min(offset + PAGE, jobs.data.count)} of {jobs.data.count}
          </span>
          <Button disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
            ← Newer
          </Button>
          <Button disabled={offset + PAGE >= jobs.data.count} onClick={() => setOffset(offset + PAGE)}>
            Older →
          </Button>
        </nav>
      )}
    </section>
  )
}

const ACTION_OPTIONS = [
  { value: '', label: 'Everything' },
  { value: 'member.', label: 'Member corrections and decisions' },
  { value: 'page.', label: 'Pages' },
  { value: 'drawing_set.', label: 'Drawing sets' },
  { value: 'project.', label: 'Projects' },
  { value: 'wireframe.', label: 'Wireframes' },
  { value: 'user.', label: 'User accounts' },
  { value: 'sections.', label: 'Section data' },
]

function Audit() {
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const debounced = useDebouncedValue(search, 300)
  const audit = useQuery({
    queryKey: ['ops', 'audit', action, debounced, offset],
    queryFn: () => listOpsAudit({ action, search: debounced, offset, limit: PAGE }),
    placeholderData: keepPreviousData,
  })
  return (
    <section className="card" aria-label="Audit log">
      <div className="filters">
        <SelectField label="Show" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0) }} options={ACTION_OPTIONS} />
        <TextField label="Search" type="search" placeholder="Person or reason" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {audit.error && <ErrorState title="Could not load the audit log" error={audit.error} />}
      {audit.data && (
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">Audit events, newest first</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Project</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.results.map((e) => {
                const project = e.project as { id: string; name: string } | null
                return (
                  <tr key={e.id}>
                    <td className="nowrap">{when(e.occurred_at)}</td>
                    <td>{e.actor ?? (e.actor_type === 'job' ? 'Background job' : 'System')}</td>
                    <td>
                      <code>{e.action}</code>
                    </td>
                    <td>{project ? <Link to={`/projects/${project.id}/history`}>{project.name}</Link> : '—'}</td>
                    <td className="ops-audit__details">
                      {e.reason && <>“{e.reason}” </>}
                      <span className="muted">{JSON.stringify(e.after ?? e.before ?? {})}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {audit.data && audit.data.count > PAGE && (
        <nav className="pagination" aria-label="Pages of audit events">
          <Button disabled={offset === 0} onClick={() => setOffset(offset - PAGE)}>
            ← Newer
          </Button>
          <Button disabled={offset + PAGE >= audit.data.count} onClick={() => setOffset(offset + PAGE)}>
            Older →
          </Button>
        </nav>
      )}
    </section>
  )
}

const hours = (h: number | null) => (h == null ? '—' : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`)
const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)}%`)

/** PRD §8 success metrics, from the recorded events (OD-22: in-house). */
function Metrics() {
  const [days, setDays] = useState(30)
  const metrics = useQuery({ queryKey: ['ops', 'metrics', days], queryFn: () => getOpsMetrics(days), placeholderData: keepPreviousData })
  if (metrics.error) return <ErrorState title="Could not load the metrics" error={metrics.error} />
  const m = metrics.data
  if (!m) return <LoadingState label="Calculating…" />
  return (
    <>
      <div className="filters">
        <SelectField
          label="Period"
          value={String(days)}
          onChange={(e) => setDays(Number(e.target.value))}
          options={[
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
            { value: '90', label: 'Last 90 days' },
          ]}
        />
      </div>
      <div className="ops-grid">
        <section className="card" aria-labelledby="m-north">
          <h2 id="m-north">Time to output (median)</h2>
          <dl className="facts">
            <dt>Upload → first page in the ABM</dt>
            <dd>{hours(m.north_star.median_hours_upload_to_abm_started)}</dd>
            <dt>Upload → project finalised</dt>
            <dd>{hours(m.north_star.median_hours_upload_to_finalised)}</dd>
            <dt>Upload → wireframe reviewed</dt>
            <dd>{hours(m.north_star.median_hours_upload_to_reviewed_wireframe)}</dd>
            <dt>Run Plan → page reviewed</dt>
            <dd>{m.review.median_minutes_run_to_page_reviewed == null ? '—' : `${m.review.median_minutes_run_to_page_reviewed} min`}</dd>
          </dl>
        </section>
        <section className="card" aria-labelledby="m-completion">
          <h2 id="m-completion">Completion</h2>
          <p className="tonnage__value">{pct(m.completion.rate)}</p>
          <p className="muted">
            {m.completion.projects_finalised} of {m.completion.projects_started} projects started in the period were finalised
            (target {pct(m.completion.target)}).
          </p>
        </section>
        <section className="card" aria-labelledby="m-quality">
          <h2 id="m-quality">Extraction quality signals</h2>
          <dl className="facts">
            <dt>Members extracted</dt>
            <dd>{m.quality.members_extracted.toLocaleString()}</dd>
            <dt>Corrections per 100 members</dt>
            <dd>{m.quality.corrections_per_100_members ?? '—'}</dd>
            <dt>Rejections per 100 members</dt>
            <dd>{m.quality.rejections_per_100_members ?? '—'}</dd>
            <dt>Extraction failure rate</dt>
            <dd>{pct(m.quality.extraction_failure_rate)}</dd>
            <dt>Pages processed or routed to review</dt>
            <dd>
              {pct(m.quality.processing_coverage)} <span className="muted">(target {pct(m.quality.processing_coverage_target)})</span>
            </dd>
          </dl>
        </section>
      </div>
      <section className="card" aria-labelledby="m-events">
        <h2 id="m-events">Tracked events (PRD §8)</h2>
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">Event counts in the period</caption>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col" className="num">
                  Count
                </th>
              </tr>
            </thead>
            <tbody>
              {m.events.map((e) => (
                <tr key={e.key}>
                  <td>{e.label}</td>
                  <td className="num">{e.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>By week</h3>
        <div className="table-wrap">
          <table className="table table--compact">
            <caption className="visually-hidden">Activity by week</caption>
            <thead>
              <tr>
                <th scope="col">Week from</th>
                <th scope="col" className="num">Uploads</th>
                <th scope="col" className="num">Pages processed</th>
                <th scope="col" className="num">Corrections</th>
                <th scope="col" className="num">Finalised</th>
              </tr>
            </thead>
            <tbody>
              {m.weeks.map((w) => (
                <tr key={w.week_start}>
                  <td>{new Date(w.week_start).toLocaleDateString()}</td>
                  <td className="num">{w.uploads}</td>
                  <td className="num">{w.pages_processed}</td>
                  <td className="num">{w.corrections}</td>
                  <td className="num">{w.finalised}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {m.notes.map((n) => (
          <p key={n} className="muted">
            {n}
          </p>
        ))}
      </section>
    </>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import { listDrawingSets } from '../../api/drawings'
import { getProjectSummary } from '../../api/review'
import type { Project, ProjectSummary } from '../../api/types'
import { ErrorState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import type { StatusTone } from '../../components/ui/StatusIcon'
import { formatTonnes, formatTons } from '../abm/format'
import { FinalizeDialog, ReopenDialog } from '../finalize/FinalizeDialog'
import { projectCan } from '../projects/useProjectPermissions'

const STATE: Record<ProjectSummary['state'], { label: string; tone: StatusTone; text: string }> = {
  not_started: {
    label: 'Not started',
    tone: 'neutral',
    text: 'Upload drawings and run Run Plan on the pages that show members.',
  },
  in_progress: {
    label: 'In progress',
    tone: 'warning',
    text: 'The ABM has unresolved items, or no page has been added yet.',
  },
  ready: {
    label: 'ABM complete',
    tone: 'success',
    text: 'Every entry in the ABM is reviewed and weighed.',
  },
}

/** Where each blocking exception is resolved: the ABM entries behind it. */
const EXCEPTION_LINKS: Record<string, string | null> = {
  entries_awaiting_review: 'status=open',
  entries_no_length: 'length_missing=true&match=matched',
  entries_not_in_section_data: 'match=unmatched,ambiguous,no_section_data',
  entries_unsupported: 'match=unsupported',
  no_section_data: null,
  test_section_data: null,
}

const REASON_LABELS: Record<string, string> = {
  failed: 'Failed',
  needs_review: 'Needs review',
  not_reviewed: 'Not reviewed',
  not_added: 'Not added',
}

const PAGES_SHOWN = 5

const WIREFRAME_LABELS: Record<string, string> = {
  not_generated: 'Not generated',
  generating: 'Generating…',
  draft: 'Draft',
  failed: 'Last generation failed',
}

type StepKey = 'upload' | 'run' | 'review' | 'add' | 'finalise'

const STEPS: { key: StepKey; label: string }[] = [
  { key: 'upload', label: 'Upload drawings' },
  { key: 'run', label: 'Run Plan' },
  { key: 'review', label: 'Review pages' },
  { key: 'add', label: 'Add to ABM' },
  { key: 'finalise', label: 'Finalise & export' },
]

/** Which workflow steps are done, from the summary. Sheets without members (cover, notes) may
 *  stay unprocessed, so pending pages never hold a step back. */
function stepsDone(s: ProjectSummary): Record<StepKey, boolean> {
  const p = s.pages
  return {
    upload: s.drawing_sets > 0 && p.total > 0,
    run: p.processed + p.reviewed + p.added > 0 && p.processing === 0,
    review: p.reviewed + p.added > 0 && p.processed === 0,
    add: p.added > 0 && p.reviewed === 0,
    finalise: s.outputs.finalized,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Project review summary (PRD §4.6): where the project is in the workflow, the one thing to
 *  do next, the headline numbers, and what still needs a person. */
export function ProjectReviewCard({ project }: { project: Project }) {
  const summary = useQuery({ queryKey: ['abm', project.id, 'review-summary'], queryFn: () => getProjectSummary(project.id), staleTime: 0 })
  // Same cache as the Drawings card: an upload, or a set finishing its preparation, refreshes the summary.
  const sets = useQuery({ queryKey: ['project', project.id, 'drawing-sets'], queryFn: () => listDrawingSets(project.id) })
  const setsSignature = (sets.data ?? []).map((d) => `${d.id}:${d.status}:${d.page_count}`).join('|')
  const refetchSummary = summary.refetch
  useEffect(() => {
    if (setsSignature) void refetchSummary()
  }, [setsSignature, refetchSummary])
  const [allPages, setAllPages] = useState(false)
  const [dialog, setDialog] = useState<'finalize' | 'reopen' | null>(null)
  const canFinalize = projectCan(project, 'project.finalize')

  if (summary.error) return <ErrorState title="Could not load the project summary" error={summary.error} onRetry={() => void summary.refetch()} />
  const s = summary.data
  if (!s) return <section className="card" aria-label="Project review"><p className="muted">Loading summary…</p></section>
  const state = STATE[s.state]
  const attention = s.pages_requiring_attention
  const shownPages = allPages ? attention.pages : attention.pages.slice(0, PAGES_SHOWN)
  const done = stepsDone(s)
  const current = STEPS.find((step) => !done[step.key])?.key ?? null
  const active = project.status === 'active'
  const finaliseHere = active && canFinalize && current === 'finalise'
  const pageCounts: [string, number][] = [
    ['Pending', s.pages.pending],
    ['Processing', s.pages.processing],
    ['Processed', s.pages.processed],
    ['Reviewed', s.pages.reviewed],
    ['Added', s.pages.added],
    ['Failed', s.pages.failed],
  ]
  const firstPage = (...reasons: string[]) => attention.pages.find((p) => reasons.includes(p.reason))
  const pageLink = (page: { id: string } | undefined) => (page ? `/projects/${project.id}/pages/${page.id}` : null)
  const firstException = s.exceptions.map((e) => EXCEPTION_LINKS[e.code]).find(Boolean)
  const exceptionCount = s.exceptions.length

  const next = nextStep()
  function nextStep(): { title: string; text: ReactNode; action: ReactNode } | null {
    const p = s!.pages
    if (project.status === 'archived') return null
    switch (current) {
      case 'upload':
        return {
          title: s!.drawing_sets ? 'Your drawings are being prepared' : 'Upload the drawing set',
          text: s!.drawing_sets
            ? 'Each page is read on its own; this takes a moment for large sets.'
            : 'Add the structural PDF in Drawings below. Each page is prepared separately.',
          action: <a className="button" href="#drawings-heading">Go to Drawings</a>,
        }
      case 'run':
        return {
          title: p.processing ? `Run Plan is working on ${plural(p.processing, 'page')}` : 'Run Plan on the framing plans',
          text: p.processing
            ? 'Members appear on each page when it finishes.'
            : 'Open Drawings below, show the pages and run Run Plan on the plan sheets. Cover, notes and detail sheets can be skipped.',
          action: <a className="button button--primary" href="#drawings-heading">Choose pages</a>,
        }
      case 'review': {
        const to = pageLink(firstPage('not_reviewed', 'needs_review'))
        return {
          title: `Review ${plural(p.processed, 'processed page')}`,
          text: 'Check the members found on each page, correct or accept them, then mark the page reviewed.',
          action: to ? <Link className="button button--primary" to={to}>Review next page</Link> : null,
        }
      }
      case 'add': {
        const to = pageLink(firstPage('not_added'))
        return {
          title: `Add ${plural(p.reviewed, 'reviewed page')} to the ABM`,
          text: 'A reviewed page counts in the ABM and tonnage once it is added.',
          action: to ? <Link className="button button--primary" to={to}>Open next page</Link> : null,
        }
      }
      case 'finalise':
        return exceptionCount
          ? {
              title: `Resolve ${plural(exceptionCount, 'open item')} in the ABM`,
              text: 'Finalising freezes a version for export (Excel, JSON, IFC). Resolve the items below first, or accept them when you finalise.',
              action: (
                <>
                  {firstException && (
                    <Link className="button button--primary" to={`/projects/${project.id}/abm?${firstException}`}>
                      Resolve in ABM
                    </Link>
                  )}
                  {finaliseHere && <Button onClick={() => setDialog('finalize')}>Finalise…</Button>}
                </>
              ),
            }
          : {
              title: 'Ready to finalise',
              text: 'Every entry is reviewed and weighed. Finalising freezes a version you can download as Excel, JSON and IFC.',
              action: finaliseHere ? (
                <Button variant="primary" onClick={() => setDialog('finalize')}>
                  Finalise…
                </Button>
              ) : null,
            }
      default:
        return {
          title: `Version ${s!.outputs.versions} is finalised`,
          text: 'The files are below. Reopen the project to make changes; this version is kept.',
          action: <a className="button" href="#outputs-heading">Download files</a>,
        }
    }
  }

  return (
    <section className="card review-card" aria-labelledby="review-card-heading">
      <div className="card__header">
        <div className="review-card__title">
          <h2 id="review-card-heading">Project review</h2>
          <StatusBadge tone={state.tone} label={state.label} />
        </div>
        <div className="button-row button-row--tight">
          <Link to={`/projects/${project.id}/history`}>Project history</Link>
          {active && canFinalize && !finaliseHere && s.abm.pages > 0 && <Button onClick={() => setDialog('finalize')}>Finalise…</Button>}
          {canFinalize && project.status === 'finalized' && <Button onClick={() => setDialog('reopen')}>Reopen…</Button>}
        </div>
      </div>
      {dialog === 'finalize' && <FinalizeDialog project={project} onClose={() => setDialog(null)} />}
      {dialog === 'reopen' && <ReopenDialog project={project} version={s.outputs.versions || null} onClose={() => setDialog(null)} />}
      <p className="muted review-card__state">{state.text}</p>

      <ol className="stepper" aria-label="Workflow">
        {STEPS.map((step, i) => {
          const status = done[step.key] ? 'done' : step.key === current ? 'current' : 'todo'
          return (
            <li key={step.key} className="stepper__step" data-status={status} aria-current={status === 'current' ? 'step' : undefined}>
              <span className="stepper__dot" aria-hidden="true">
                {status === 'done' ? '✓' : i + 1}
              </span>
              <span className="stepper__label">
                {step.label}
                <span className="visually-hidden">{status === 'done' ? ' (done)' : status === 'current' ? ' (current step)' : ''}</span>
              </span>
            </li>
          )
        })}
      </ol>

      {next && (
        <div className="next-step" role="group" aria-label="Next step">
          <div>
            <p className="next-step__eyebrow">Next step</p>
            <p className="next-step__title">{next.title}</p>
            <p className="next-step__text">{next.text}</p>
          </div>
          {next.action && <div className="button-row button-row--tight next-step__actions">{next.action}</div>}
        </div>
      )}

      <div className="kpis">
        <div className="kpi">
          <p className="kpi__label">Pages</p>
          <p className="kpi__value">{s.pages.total}</p>
          <p className="kpi__sub">
            in {plural(s.drawing_sets, 'drawing set')} · {s.pages.added} in the ABM
          </p>
          <dl className="kpi__breakdown" aria-label="Pages by status">
            {pageCounts
              .filter(([, n]) => n > 0)
              .map(([label, n]) => (
                <div key={label} data-attention={label === 'Failed' ? true : undefined}>
                  <dt>{label}</dt>
                  <dd>{n}</dd>
                </div>
              ))}
          </dl>
        </div>
        <div className="kpi">
          <p className="kpi__label">ABM</p>
          <p className="kpi__value">{s.abm.entries}</p>
          <p className="kpi__sub">
            {s.abm.entries === 1 ? 'entry' : 'entries'} from {plural(s.abm.pages, 'page')}
            {s.abm.complete ? (s.abm.entries ? ' · complete' : '') : ' · not complete'}
          </p>
          {s.abm.pages > 0 && <Link to={`/projects/${project.id}/abm`}>Open ABM</Link>}
        </div>
        <div className="kpi">
          <p className="kpi__label">Reviewed tonnage</p>
          <p className="kpi__value">{formatTons(s.tonnage.reviewed)}</p>
          <p className="kpi__sub">
            {formatTonnes(s.tonnage.reviewed)}
            {Number(s.tonnage.not_final.lb) > 0 && <> · {formatTons(s.tonnage.not_final)} not final</>}
          </p>
        </div>
        <div className="kpi" data-attention={exceptionCount ? true : undefined}>
          <p className="kpi__label">Open items</p>
          <p className="kpi__value">{exceptionCount}</p>
          <p className="kpi__sub">{exceptionCount ? 'to resolve before export' : s.abm.pages ? 'none in the ABM' : 'none yet'}</p>
        </div>
        <div className="kpi">
          <p className="kpi__label">Wireframe</p>
          <p className="kpi__value kpi__value--text">{WIREFRAME_LABELS[s.outputs.wireframe] ?? s.outputs.wireframe}</p>
          <p className="kpi__sub">
            {s.outputs.finalized
              ? `Finalised, version ${s.outputs.versions}`
              : s.outputs.versions
                ? `Reopened after version ${s.outputs.versions}`
                : 'Not finalised'}
          </p>
          <Link to={`/projects/${project.id}/wireframe`}>Open wireframe</Link>
        </div>
      </div>

      {exceptionCount > 0 && (
        <div className="review-card__block">
          <h3>Unresolved exceptions</h3>
          <ul className="review-card__list" aria-label="Unresolved exceptions">
            {s.exceptions.map((e) => {
              const link = EXCEPTION_LINKS[e.code]
              return (
                <li key={e.code}>
                  {e.message} {link && <Link to={`/projects/${project.id}/abm?${link}`}>Show</Link>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {attention.count > 0 && (
        <div className="review-card__block">
          <h3>
            Pages to look at <span className="muted">({attention.count})</span>
          </h3>
          <p className="muted">These pages are not in the ABM. Sheets without members (notes, details) can stay as they are.</p>
          <ul className="review-card__list" aria-label="Pages to look at">
            {shownPages.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${project.id}/pages/${p.id}`}>
                  Page {p.page_number} · {p.drawing_set.original_filename}
                </Link>{' '}
                <StatusBadge tone={p.reason === 'failed' ? 'error' : 'warning'} label={REASON_LABELS[p.reason] ?? p.reason} />{' '}
                <span className="muted">{p.message}</span>
              </li>
            ))}
          </ul>
          {attention.pages.length > PAGES_SHOWN && (
            <Button onClick={() => setAllPages((a) => !a)}>{allPages ? 'Show fewer' : `Show all ${attention.pages.length}`}</Button>
          )}
          {attention.count > attention.pages.length && <p className="muted">The first {attention.pages.length} are listed.</p>}
        </div>
      )}

      {s.last_activity && (
        <p className="muted review-card__last">
          Last change {new Date(s.last_activity.occurred_at).toLocaleString()}
          {s.last_activity.actor ? ` by ${s.last_activity.actor}` : ''}.
        </p>
      )}
    </section>
  )
}

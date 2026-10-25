import { useId, useState } from 'react'

import type { DrawingPage, ReviewReason } from '../../api/types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { isActiveJob, JOB_STATUS, PAGE_KIND_LABELS } from './status'

/** Job progress / outcome and the current analysis result for one page. */
/** ``showReasons`` is off where the full issue list is shown instead (page viewer). */
export function PageResult({ page, showReasons = true }: { page: DrawingPage; showReasons?: boolean }) {
  const job = page.latest_job
  const run = page.current_run
  const active = isActiveJob(job)

  return (
    <>
      {job && active && (
        <div className="page-card__progress" aria-live="polite">
          <div
            className="progress"
            role="progressbar"
            aria-label={`Processing page ${page.page_number}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progress}
          >
            <div className="progress__bar" style={{ width: `${job.progress}%` }} />
          </div>
          <span className="muted">
            {JOB_STATUS[job.status].label}
            {job.stage ? ` — ${job.stage}` : ''}
          </span>
        </div>
      )}

      {job && !active && (
        <div className="page-card__outcome">
          <StatusBadge tone={JOB_STATUS[job.status].tone} label={JOB_STATUS[job.status].label} />
          {job.status === 'failed' && <p className="page-card__error">{job.error_message}</p>}
        </div>
      )}

      {run && (
        <div className="page-card__result">
          <p>
            <strong>{PAGE_KIND_LABELS[run.page_kind]}</strong>
            <span className="muted">
              {' '}
              · {run.member_count} member {run.member_count === 1 ? 'label' : 'labels'}
              {run.scale_text ? ` · ${run.scale_text}` : ' · scale not found'}
            </span>
          </p>
          {run.engine_outdated && (
            <p className="page-card__outdated">
              Read with an older version of Steelo ({run.engine_version}
              {run.current_engine_version ? `; now ${run.current_engine_version}` : ''}). Run again to read it with the
              latest rules.
            </p>
          )}
          {showReasons && run.review_reasons.length > 0 && (
            <ReviewReasons reasons={run.review_reasons} pageNumber={page.page_number} />
          )}
        </div>
      )}
    </>
  )
}

/** About three lines of a page card: a first reason longer than this is cut short. */
const SHORT_REASON = 110

/** Why a page needs review: the first reason, cut to three lines, until asked for the rest
 * (so one wordy page doesn't stretch every card in its row). */
function ReviewReasons({ reasons, pageNumber }: { reasons: ReviewReason[]; pageNumber: number }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const more = reasons.length > 1 || reasons[0]!.message.length > SHORT_REASON
  const shown = open ? reasons : reasons.slice(0, 1)
  return (
    <>
      <ul
        id={id}
        className="review-reasons"
        data-collapsed={more && !open ? '' : undefined}
        aria-label={`Why page ${pageNumber} needs review`}
      >
        {shown.map((reason) => (
          <li key={reason.code}>{reason.message}</li>
        ))}
      </ul>
      {more && (
        <button
          type="button"
          className="link-button review-reasons__toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : reasons.length > 1 ? `Read more (${reasons.length - 1} more)` : 'Read more'}
        </button>
      )}
    </>
  )
}

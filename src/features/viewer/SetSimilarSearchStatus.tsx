import type { FindSimilarResult } from '../../api/processing'
import type { SimilarColumnsJob } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { isSearching } from './useSetSimilarSearch'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const added = (result: FindSimilarResult) => `${plural(result.added, 'column')} added on ${plural(result.pages.length, 'page')}`

/** Where a set-wide "Find similar" stands: progress while it runs (the person keeps working),
 *  then what it added, or why it stopped and what it added before. */
export function SetSimilarSearchStatus({ job, onDismiss }: { job: SimilarColumnsJob; onDismiss: () => void }) {
  if (isSearching(job)) {
    return (
      <span className="similar-result" role="status">
        Searching every plan of this set: {job.pages_total ? `${job.pages_done} of ${job.pages_total} plans` : job.stage}
        {job.result?.added ? ` · ${plural(job.result.added, 'column')} added so far` : ''}{' '}
        <progress value={job.progress} max={100} aria-label="Search progress" />
      </span>
    )
  }
  return (
    <span className="similar-result" role="status">
      {job.status === 'completed'
        ? job.result?.added
          ? `${added(job.result)}.`
          : 'No more found on the other plans.'
        : `${job.error_message}${job.result?.added ? ` ${added(job.result)} before it stopped.` : ''}`}{' '}
      <Button aria-label="Dismiss" onClick={onDismiss}>
        ×
      </Button>
    </span>
  )
}

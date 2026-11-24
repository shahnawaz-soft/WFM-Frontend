import { Button } from './Button'
import type { usePage } from './usePage'

/** "Rows 201–400 of 13,189" with Previous / Next; nothing when everything fits on one page. */
export function Pager({ label, count, view }: { label: string; count: number; view: ReturnType<typeof usePage> }) {
  if (view.pages <= 1) return null
  return (
    <nav className="pager" aria-label={label}>
      <span className="muted">
        Rows {(view.start + 1).toLocaleString()}–{view.end.toLocaleString()} of {count.toLocaleString()}
      </span>
      <Button disabled={view.page === 0} onClick={() => view.setPage(view.page - 1)}>
        ‹ Previous
      </Button>
      <span className="muted">
        Page {view.page + 1} of {view.pages}
      </span>
      <Button disabled={view.page >= view.pages - 1} onClick={() => view.setPage(view.page + 1)}>
        Next ›
      </Button>
    </nav>
  )
}

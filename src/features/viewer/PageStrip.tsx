import type { DrawingPageListItem } from '../../api/types'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Thumbnail } from '../drawings/Thumbnail'
import { PAGE_STATUS } from '../drawings/status'

interface PageStripProps {
  pages: DrawingPageListItem[]
  currentId: string
  setName: string
  onOpen: (id: string) => void
}

/** All pages of the set, for quick navigation (like a sheet index). */
export function PageStrip({ pages, currentId, setName, onOpen }: PageStripProps) {
  return (
    <nav className="page-strip" aria-label="Pages in this drawing set">
      <ol>
        {pages.map((p) => {
          const status = PAGE_STATUS[p.status]
          const count = p.current_run?.member_count
          return (
            <li key={p.id}>
              <button
                type="button"
                className="page-strip__item"
                aria-current={p.id === currentId ? 'page' : undefined}
                onClick={() => onOpen(p.id)}
                aria-label={`Page ${p.page_number}, ${status.label}${count ? `, ${count} members` : ''}`}
              >
                <Thumbnail page={p} alt="" />
                <span className="page-strip__meta">
                  <span>Page {p.page_number}</span>
                  <StatusBadge tone={status.tone} label={status.label} />
                </span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="visually-hidden">{setName}</p>
    </nav>
  )
}

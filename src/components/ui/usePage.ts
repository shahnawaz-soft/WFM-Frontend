import { useState } from 'react'

/** Rows a long table shows at once: thousands of rows (13,000 wireframe elements) froze the
 *  page while the browser laid them out. */
export const PAGE_ROWS = 200

/** Which slice of ``count`` rows to show. ``focus`` (a row index, e.g. the element picked in the
 *  3D view) brings its page into view whenever it changes. */
export function usePage(count: number, focus: number | null, size = PAGE_ROWS) {
  const [page, setPage] = useState(0)
  const [seenFocus, setSeenFocus] = useState<number | null>(null)
  const pages = Math.max(1, Math.ceil(count / size))
  let current = Math.min(page, pages - 1)
  if (focus !== null && focus >= 0 && focus !== seenFocus) {
    setSeenFocus(focus)
    const wanted = Math.floor(focus / size)
    if (wanted !== current) {
      setPage(wanted)
      current = wanted
    }
  }
  return { page: current, pages, start: current * size, end: Math.min(count, (current + 1) * size), setPage }
}

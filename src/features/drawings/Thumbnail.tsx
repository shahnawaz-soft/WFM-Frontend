import { useEffect, useRef, useState } from 'react'

import { fetchThumbnail } from '../../api/drawings'
import type { DrawingPageListItem } from '../../api/types'

/** Loads a page thumbnail (authenticated) only once it scrolls near the viewport. */
export function Thumbnail({ page, alt }: { page: Pick<DrawingPageListItem, 'id' | 'thumbnail_status'>; alt: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const ready = page.thumbnail_status === 'ready'

  useEffect(() => {
    if (visible || !ref.current) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || !ready) return
    const controller = new AbortController()
    let objectUrl: string | null = null
    fetchThumbnail(page.id, controller.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [visible, ready, page.id])

  return (
    <div ref={ref} className="thumbnail">
      {url ? (
        <img src={url} alt={alt} />
      ) : (
        <span className="thumbnail__placeholder" aria-hidden="true">
          {page.thumbnail_status === 'failed' || failed ? '!' : ready ? '' : '…'}
        </span>
      )}
    </div>
  )
}

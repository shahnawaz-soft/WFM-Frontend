import { useEffect, useRef, useState } from 'react'

import type { PageViewport, PDFDocumentProxy, RenderTask } from './pdf'

/** Largest canvas we render (browsers fail or crawl beyond this); CSS size is unaffected. */
const MAX_CANVAS_PIXELS = 36_000_000
const MAX_CANVAS_SIDE = 8192

interface PdfPageCanvasProps {
  doc: PDFDocumentProxy
  pageNumber: number
  /** 1 = 100% (72 dpi PDF points to CSS pixels). */
  zoom: number
  label: string
  onRendered?: () => void
  /** Called with the CSS-pixel viewport (PDF.js handles rotation and the y-axis flip), so
   *  overlays can place PDF-space coordinates exactly on the rendered page. */
  onViewport?: (viewport: PageViewport) => void
}

/** Renders one page at the requested zoom; re-renders sharply whenever zoom changes. */
export function PdfPageCanvas({ doc, pageNumber, zoom, label, onRendered, onViewport }: PdfPageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let task: RenderTask | null = null
    let cancelled = false

    doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || !canvasRef.current) return
        const cssViewport = page.getViewport({ scale: zoom }) // honours the page's /Rotate
        onViewport?.(cssViewport)
        const ratio = window.devicePixelRatio || 1
        const wanted = cssViewport.width * cssViewport.height * ratio * ratio
        const capped = Math.min(
          ratio,
          Math.sqrt(MAX_CANVAS_PIXELS / Math.max(cssViewport.width * cssViewport.height, 1)),
          MAX_CANVAS_SIDE / Math.max(cssViewport.width, cssViewport.height),
        )
        const renderViewport = page.getViewport({
          scale: zoom * (wanted > 0 ? capped : 1),
        })
        const canvas = canvasRef.current
        canvas.width = Math.floor(renderViewport.width)
        canvas.height = Math.floor(renderViewport.height)
        canvas.style.width = `${Math.floor(cssViewport.width)}px`
        canvas.style.height = `${Math.floor(cssViewport.height)}px`
        task = page.render({ canvas, viewport: renderViewport })
        return task.promise.then(() => {
          if (!cancelled) onRendered?.()
        })
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof Error && err.name === 'RenderingCancelledException')) return
        console.error('Page render failed', err)
        setError('This page could not be displayed.')
      })

    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, zoom, onRendered, onViewport])

  if (error) return <p className="field__error">{error}</p>
  return <canvas ref={canvasRef} className="viewer__canvas" role="img" aria-label={label} />
}

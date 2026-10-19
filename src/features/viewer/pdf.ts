/**
 * PDF.js setup. Imported only by the (lazy-loaded) page viewer, so PDF.js stays out of the
 * main bundle. Pages are rendered from the original vector PDF: crisp at any zoom.
 */
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { PageViewport } from 'pdfjs-dist/types/src/display/page_viewport'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()

export type { PageViewport, PDFDocumentProxy, PDFPageProxy, RenderTask }

export function loadPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  // PDF.js ≥ 6.2.108 (GHSA-hq66-cqwq-w95j fixed; the font eval path no longer exists).
  // No annotation, form or scripting layers are rendered: drawings are shown as images.
  return pdfjs.getDocument({ data, enableXfa: false }).promise
}

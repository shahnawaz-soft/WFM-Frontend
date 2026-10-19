import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { fetchOriginalPdf, getPage } from '../../api/drawings'
import { listPageMembers } from '../../api/members'
import { LoadingState } from '../../components/feedback/States'
import { DrawingStage, type FocusRequest } from '../viewer/DrawingStage'
import { loadPdf } from '../viewer/pdf'

interface AbmDrawingProps {
  projectId: string
  pageId: string
  fileName: string
  selectedId: string | null
  hoveredId: string | null
  focus: FocusRequest | null
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  placing?: boolean
  onPlace?: (point: [number, number]) => void
  onCancelPlace?: () => void
}

/** The source drawing of the selected ABM entry, with that page's members outlined. Shares
 *  its caches with the page workspace, so switching between the two does not reload. */
export function AbmDrawing(props: AbmDrawingProps) {
  const { projectId, pageId, fileName } = props
  const [download, setDownload] = useState<{ loaded: number; total?: number } | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const page = useQuery({ queryKey: ['drawing-page', pageId], queryFn: () => getPage(pageId) })
  const setId = page.data?.drawing_set
  const pdf = useQuery({
    queryKey: ['drawing-set', setId, 'pdf'],
    queryFn: async () => loadPdf(await fetchOriginalPdf(setId!, (loaded, total) => setDownload({ loaded, total }))),
    enabled: Boolean(setId),
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: false,
  })
  const runId = page.data?.current_run?.id
  const members = useQuery({
    queryKey: ['drawing-page', pageId, 'members', runId],
    queryFn: () => listPageMembers(pageId),
    enabled: Boolean(page.data),
  })

  if (!page.data) return <LoadingState label="Opening drawing…" />
  const current = page.data

  return (
    <DrawingStage
      key={pageId}
      widthPt={current.width_pt ?? 0}
      heightPt={current.height_pt ?? 0}
      rotation={current.rotation}
      pageNumber={current.page_number}
      label={`Drawing: page ${current.page_number} of ${fileName}`}
      pdfState={pdf}
      download={download}
      members={members.data ?? []}
      showLabels={showLabels}
      selectedId={props.selectedId}
      hoveredId={props.hoveredId}
      focus={props.focus}
      onSelect={props.onSelect}
      onHover={props.onHover}
      placing={props.placing}
      onPlace={props.onPlace}
      onCancelPlace={props.onCancelPlace}
      toolbar={
        <>
          <strong className="abm-drawing__title">
            Page {current.page_number} <span className="muted">· {fileName}</span>
          </strong>
          <Link
            className="button button--secondary"
            to={`/projects/${projectId}/pages/${pageId}${props.selectedId ? `?member=${props.selectedId}` : ''}`}
          >
            Open page
          </Link>
          <label className="checkbox">
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels
          </label>
        </>
      }
    />
  )
}

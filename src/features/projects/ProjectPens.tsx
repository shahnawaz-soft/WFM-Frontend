import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { toApiError } from '../../api/errors'
import { getPenAt, setProjectPens, type Pen, type ProjectPens } from '../../api/processing'
import type { Project } from '../../api/types'
import { LoadingState } from '../../components/feedback/States'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert } from '../../components/ui/Field'

type Kind = 'member' | 'grid'
const KINDS: Record<Kind, string> = { member: 'Member lines', grid: 'Grid lines' }

function pensOf(project: Project): ProjectPens {
  const pens = (project.pens ?? {}) as Partial<ProjectPens>
  return { member: pens.member ?? [], grid: pens.grid ?? [] }
}

const samePen = (a: Pen, b: Pen) => a.width === b.width && (a.colour || '') === (b.colour || '')

function PenChip({ pen, onRemove }: { pen: Pen; onRemove?: () => void }) {
  const name = [pen.width != null ? `${pen.width} pt` : 'any width', pen.colour || 'any colour'].join(' · ')
  return (
    <span className="pen-chip">
      <span className="pen-chip__swatch" aria-hidden="true" style={{ background: pen.colour || 'transparent', height: Math.max(2, Math.min(8, (pen.width ?? 1) * 2)) }} />
      {name}
      {onRemove && (
        <button type="button" className="link-button" aria-label={`Remove pen ${name}`} onClick={onRemove}>
          ×
        </button>
      )}
    </span>
  )
}

/** Saving pens runs the project's pages again: say what happened. */
function useSavePens(project: Project, onDone?: () => void) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (pens: ProjectPens) => setProjectPens(project.id, pens),
    meta: { suppressErrorToast: true },
    onSuccess: async (result) => {
      const ran = `${result.queued.length} page${result.queued.length === 1 ? '' : 's'} running again`
      const left = result.skipped.length ? `; ${result.skipped.length} with review work left as they are (run them again from the page)` : ''
      notify.success(`Pens saved: ${ran}${left}.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-page'] }),
        queryClient.invalidateQueries({ queryKey: ['drawing-set'] }),
      ])
      onDone?.()
    },
  })
}

/** The project's pens, in its settings: what is read as members and grid lines, removable. */
export function ProjectPensList({ project, canEdit }: { project: Project; canEdit: boolean }) {
  const pens = pensOf(project)
  const save = useSavePens(project)
  const none = !pens.member.length && !pens.grid.length
  return (
    <section className="project-pens" aria-label="Pens">
      <h3>Pens</h3>
      {none ? (
        <p className="muted">
          None set: members are the lines drawn 0.9 pt or heavier, grids every line with a bubble. To set them, choose Pens in
          page review and click a line on the drawing.
        </p>
      ) : (
        (['member', 'grid'] as const).map((kind) => (
          <p key={kind}>
            <strong>{KINDS[kind]}:</strong>{' '}
            {pens[kind].length === 0 ? (
              <span className="muted">any (as usual)</span>
            ) : (
              pens[kind].map((pen) => (
                <PenChip
                  key={`${pen.width}|${pen.colour}`}
                  pen={pen}
                  onRemove={canEdit && !save.isPending ? () => save.mutate({ ...pens, [kind]: pens[kind].filter((p) => !samePen(p, pen)) }) : undefined}
                />
              ))
            )}
          </p>
        ))
      )}
      {save.isPending && <LoadingState label="Saving the pens…" />}
      {save.error && <FormAlert message={toApiError(save.error).message} />}
      {!none && <p className="muted">Removing a pen runs the project’s pages again (pages with review work are left as they are).</p>}
    </section>
  )
}

/** The pen of the line clicked on the drawing, and whether the project reads members or grid
 *  lines by it. */
export function PickedPenDialog({
  project,
  pageId,
  point,
  onClose,
}: {
  project: Project
  pageId: string
  point: [number, number]
  onClose: () => void
}) {
  const pen = useQuery({ queryKey: ['pen-at', pageId, point], queryFn: () => getPenAt(pageId, point), retry: false })
  const pens = pensOf(project)
  const save = useSavePens(project, onClose)
  const picked: Pen | null = pen.data ? { width: pen.data.width, colour: pen.data.colour } : null
  const use = (kind: Kind) => picked && save.mutate({ ...pens, [kind]: [...pens[kind].filter((p) => !samePen(p, picked)), picked] })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Pen of this line">
      {pen.isPending && <LoadingState label="Reading the line…" />}
      {pen.error && <FormAlert message={toApiError(pen.error).message} />}
      {pen.data && picked && (
        <>
          <p>
            <PenChip pen={picked} /> · {pen.data.same_pen} line{pen.data.same_pen === 1 ? '' : 's'} drawn with it on this page.
          </p>
          <p className="muted">
            Set it as the project’s member pen and only lines drawn with your member pens are read as members (on every page);
            as a grid pen, grid lines are looked for only among lines drawn with your grid pens. The project’s pages run again
            (pages with review work are left as they are).
          </p>
          {save.error && <FormAlert message={toApiError(save.error).message} />}
          {save.isPending && <LoadingState label="Saving the pens…" />}
          <div className="button-row">
            <Button variant="primary" disabled={save.isPending} onClick={() => use('member')}>
              Member lines are this pen
            </Button>
            <Button disabled={save.isPending} onClick={() => use('grid')}>
              Grid lines are this pen
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </>
      )}
      {!pen.isPending && !pen.data && (
        <div className="button-row">
          <Button onClick={onClose}>Close</Button>
        </div>
      )}
    </Dialog>
  )
}

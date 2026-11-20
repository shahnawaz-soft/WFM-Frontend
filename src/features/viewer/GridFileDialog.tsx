import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { toApiError } from '../../api/errors'
import { gridEditsOf, importPageGrids, type PageGridEdits, type PageGridImportResult } from '../../api/processing'
import type { DrawingPage } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert } from '../../components/ui/Field'

interface GridFileDialogProps {
  page: DrawingPage
  onSaved: (before: PageGridEdits, message: string) => void
  onClose: () => void
}

const STATUS: Record<PageGridImportResult['grids'][number]['status'], string> = {
  reference: 'Measured from',
  set: 'Gets the file’s distance',
  not_on_page: 'Not on this page: left out',
  order_differs: 'On the other side on the drawing: left out',
}

/** Upload a grids file exported from Tekla (or a grids CSV), as the old Wireframer's "Attach
 *  Grids CSV": the page's grids that are in the file get its distances, exact. The lines stay
 *  where they are drawn; grids not on the page are left out. Previewed before it is applied. */
export function GridFileDialog({ page, onSaved, onClose }: GridFileDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [reviewWarning, setReviewWarning] = useState<string | null>(null)
  const before = gridEditsOf(page.grid_edits)

  const preview = useMutation({
    mutationFn: (chosen: File) => importPageGrids(page.id, chosen, false),
    meta: { suppressErrorToast: true },
  })
  const apply = useMutation({
    mutationFn: (discardReview: boolean) => importPageGrids(page.id, file!, true, { discardReview }),
    meta: { suppressErrorToast: true },
    onSuccess: (result) => {
      const n = result.grids.filter((g) => g.status === 'set').length
      onSaved(before, `Distances from the grids file set on ${n} ${n === 1 ? 'grid' : 'grids'}: run the page again when you have finished with its grids`)
    },
    onError: (error) => {
      const apiError = toApiError(error)
      if (apiError.code === 'review_in_progress') setReviewWarning(apiError.message)
    },
  })

  const rows = preview.data?.grids ?? []
  const setting = rows.filter((g) => g.status === 'set').length
  const failure = preview.error ?? (reviewWarning ? null : apply.error)

  return (
    <>
      <Dialog
        open={!reviewWarning}
        onOpenChange={(o) => !o && onClose()}
        title="Upload grids"
        description="A grids file exported from Tekla (COORDINATES and LABELS), or a grids CSV. The grids of this page that are in the file get its distances, exact; their lines stay where they are drawn."
      >
        <FormAlert message={failure ? (toApiError(failure).fieldErrors.file?.[0] ?? toApiError(failure).message) : null} />
        <label className="field">
          <span className="field__label">Grids file</span>
          <input
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            onChange={(e) => {
              const chosen = e.target.files?.[0] ?? null
              setFile(chosen)
              apply.reset()
              if (chosen) preview.mutate(chosen)
              else preview.reset()
            }}
          />
        </label>
        {preview.isPending && <p className="muted">Reading the file…</p>}
        {rows.length > 0 && (
          <div className="panel__table">
            <table className="table table--compact">
              <caption className="visually-hidden">The grids in the file, against this page</caption>
              <thead>
                <tr>
                  <th scope="col">Grid</th>
                  <th scope="col">From</th>
                  <th scope="col">File</th>
                  <th scope="col">Drawing measures</th>
                  <th scope="col">Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g, i) => (
                  <tr key={`${g.label}-${i}`} className={g.status === 'not_on_page' || g.status === 'order_differs' ? 'muted' : undefined}>
                    <td>{g.label}</td>
                    <td>{g.reference ?? ''}</td>
                    <td className="nowrap">{g.distance ?? ''}</td>
                    <td className="nowrap">{g.drawn_distance ?? ''}</td>
                    <td>{STATUS[g.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="button-row">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!setting} loading={apply.isPending} onClick={() => apply.mutate(false)}>
            {setting ? `Apply to ${setting} ${setting === 1 ? 'grid' : 'grids'}` : 'Apply'}
          </Button>
        </div>
      </Dialog>
      <ConfirmDialog
        open={reviewWarning !== null}
        title="This page has review work"
        confirmLabel="Run again and replace review"
        tone="danger"
        pending={apply.isPending}
        error={reviewWarning && apply.error && toApiError(apply.error).code !== 'review_in_progress' ? toApiError(apply.error).message : null}
        onConfirm={() => apply.mutate(true)}
        onCancel={() => {
          setReviewWarning(null)
          apply.reset()
        }}
      >
        <p>{reviewWarning}</p>
      </ConfirmDialog>
    </>
  )
}

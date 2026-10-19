import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { toApiError } from '../../api/errors'
import { finalizeProject, getFinalizeCheck, reopenProject } from '../../api/review'
import type { Project } from '../../api/types'
import { LoadingState } from '../../components/feedback/States'
import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { FormAlert, TextField } from '../../components/ui/Field'
import { notify } from '../../components/feedback/toastStore'
import { formatTonnes, formatTons } from '../abm/format'

/** Pre-finalise checklist and finalisation (OD-14b: unresolved exceptions are accepted
 *  explicitly; the acknowledgement is recorded in the version and the history). */
export function FinalizeDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const queryClient = useQueryClient()
  const check = useQuery({ queryKey: ['finalize-check', project.id], queryFn: () => getFinalizeCheck(project.id), staleTime: 0 })
  const [acknowledged, setAcknowledged] = useState(false)
  const [note, setNote] = useState('')
  const finalize = useMutation({
    mutationFn: () => finalizeProject(project.id, acknowledged, note),
    meta: { suppressErrorToast: true },
    onSuccess: (version) => {
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['abm', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['outputs', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['finalize-check', project.id] })
      onClose()
      notify.success(`Finalised as version ${version.version_no}`)
    },
  })
  const c = check.data

  function submit(event: FormEvent) {
    event.preventDefault()
    finalize.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={c ? `Finalise version ${c.next_version}` : 'Finalise'}>
      {!c ? (
        check.error ? (
          <FormAlert message={toApiError(check.error).message} />
        ) : (
          <LoadingState label="Checking the project…" />
        )
      ) : (
        <form onSubmit={submit} noValidate className="finalize">
          <p>
            Finalising freezes the ABM, its totals and the latest wireframe as{' '}
            <strong>version {c.next_version}</strong>, and makes the project read-only until it is reopened.
          </p>
          <dl className="facts">
            <dt>ABM</dt>
            <dd>
              {c.abm.entries} {c.abm.entries === 1 ? 'entry' : 'entries'} from {c.abm.pages}{' '}
              {c.abm.pages === 1 ? 'page' : 'pages'}
            </dd>
            <dt>Reviewed tonnage</dt>
            <dd>
              {formatTons(c.tonnage.reviewed)} ({formatTonnes(c.tonnage.reviewed)})
              {Number(c.tonnage.not_final.lb) > 0 && <> · {formatTons(c.tonnage.not_final)} not final</>}
            </dd>
            <dt>Wireframe</dt>
            <dd>
              {c.wireframe && c.wireframe.status === 'draft'
                ? `Revision ${c.wireframe.revision_no} is included`
                : 'None included'}
            </dd>
          </dl>

          {c.blocking.length > 0 && (
            <div className="form-alert" role="alert">
              <span aria-hidden="true" className="form-alert__icon">
                !
              </span>
              <ul className="finalize__list">
                {c.blocking.map((b) => (
                  <li key={b.code}>{b.message}</li>
                ))}
              </ul>
            </div>
          )}

          {c.exceptions.length > 0 && (
            <fieldset className="finalize__exceptions">
              <legend>Unresolved exceptions</legend>
              <ul className="finalize__list">
                {c.exceptions.map((e) => (
                  <li key={e.code}>{e.message}</li>
                ))}
              </ul>
              <label className="checkbox finalize__ack">
                <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} /> I accept
                these unresolved items in version {c.next_version}
              </label>
              <p className="muted">They are listed in the finalised version and in the project history, with your name.</p>
            </fieldset>
          )}
          {c.exceptions.length === 0 && c.blocking.length === 0 && (
            <p className="review-card__ok">✓ No unresolved exceptions.</p>
          )}
          {c.pages_not_included.count > 0 && (
            <p className="muted">
              {c.pages_not_included.count} {c.pages_not_included.count === 1 ? 'page is' : 'pages are'} not in the ABM
              (failed, not reviewed or not added). They are recorded in the version.
            </p>
          )}

          <TextField label="Note (optional)" placeholder="e.g. Bid issue, addendum 2" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          <FormAlert message={finalize.error ? toApiError(finalize.error).message : null} />
          <div className="button-row">
            <Button
              type="submit"
              variant="primary"
              loading={finalize.isPending}
              disabled={!c.can_finalize || (c.requires_acknowledgement && !acknowledged)}
            >
              Finalise version {c.next_version}
            </Button>
            <Button onClick={onClose}>Cancel</Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

export function ReopenDialog({ project, version, onClose }: { project: Project; version: number | null; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reopen = useMutation({
    mutationFn: () => reopenProject(project.id, reason.trim()),
    meta: { suppressErrorToast: true, successMessage: 'Project reopened' },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['abm', project.id] })
      void queryClient.invalidateQueries({ queryKey: ['outputs', project.id] })
      onClose()
    },
    onError: (e) => setError(toApiError(e).message),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!reason.trim()) return setError('Say why the project is reopened.')
    reopen.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Reopen the project?">
      <form onSubmit={submit} noValidate>
        <p>
          The project becomes editable again. {version ? `Version ${version} stays exactly as it was; ` : ''}finalising
          again creates a new version.
        </p>
        <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Addendum 3 received" error={error ?? undefined} autoFocus />
        <div className="button-row">
          <Button type="submit" variant="primary" loading={reopen.isPending}>
            Reopen project
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  )
}

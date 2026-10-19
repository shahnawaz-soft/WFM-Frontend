import { useState } from 'react'

import { toApiError } from '../../api/errors'
import { downloadOutput, type OutputFormat } from '../../api/review'
import type { OutputVersion, Project } from '../../api/types'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { formatTonnes, formatTons, type Amounts } from '../abm/format'
import { useOutputVersions } from './useOutputVersions'

const SUFFIX: Record<OutputFormat, string> = { xlsx: '-ABM.xlsx', json: '.json', ifc: '-wireframe.ifc' }

const fileBase = (project: Project, v: OutputVersion) =>
  `${project.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'project'}-v${v.version_no}`

/** Downloading a finalised version's files (busy and error state shared by its buttons). */
function useDownload(project: Project) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const download = async (v: OutputVersion, format: OutputFormat) => {
    setBusy(`${v.id}-${format}`)
    setError(null)
    try {
      await downloadOutput(v.id, format, `${fileBase(project, v)}${SUFFIX[format]}`)
    } catch (e) {
      setError(toApiError(e).message)
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, download }
}

/** Excel, JSON and (when the version has a wireframe) IFC downloads of one version. */
export function VersionDownloads({ project, version: v }: { project: Project; version: OutputVersion }) {
  const { busy, error, download } = useDownload(project)
  const summary = v.summary as { wireframe_revision: number | null }
  return (
    <div>
      {error && <p className="field__error">{error}</p>}
      <div className="button-row button-row--tight">
        <Button onClick={() => void download(v, 'xlsx')} loading={busy === `${v.id}-xlsx`} aria-label={`Download version ${v.version_no} as Excel`}>
          Excel
        </Button>
        <Button onClick={() => void download(v, 'json')} loading={busy === `${v.id}-json`} aria-label={`Download version ${v.version_no} as JSON`}>
          JSON
        </Button>
        {summary.wireframe_revision && (
          <Button
            onClick={() => void download(v, 'ifc')}
            loading={busy === `${v.id}-ifc`}
            aria-label={`Download version ${v.version_no} wireframe as IFC for Tekla`}
          >
            IFC (Tekla)
          </Button>
        )}
      </div>
    </div>
  )
}

/** Finalised versions of the project, newest first, with their downloads. */
export function ProjectOutputsCard({ project }: { project: Project }) {
  const versions = useOutputVersions(project.id)
  if (!versions.data?.length) return null

  return (
    <section className="card" aria-labelledby="outputs-heading">
      <div className="card__header">
        <h2 id="outputs-heading">Finalised versions</h2>
      </div>
      <ol className="outputs" aria-label="Finalised versions">
        {versions.data.map((v) => {
          const summary = v.summary as { entries: number; reviewed: Amounts; complete: boolean; wireframe_revision: number | null }
          return (
            <li key={v.id} className="outputs__item">
              <div>
                <p className="outputs__title">
                  <strong>Version {v.version_no}</strong>{' '}
                  {v.is_current ? <StatusBadge tone="info" label="Current" /> : <StatusBadge tone="neutral" label="Superseded" />}
                  {v.exceptions_acknowledged && <StatusBadge tone="warning" label={`${v.exceptions.length} exceptions accepted`} />}
                </p>
                <p className="muted">
                  Finalised by {v.finalized_by} on {new Date(v.created_at).toLocaleString()} · {summary.entries} entries ·{' '}
                  {formatTons(summary.reviewed)} ({formatTonnes(summary.reviewed)})
                  {summary.wireframe_revision ? ` · wireframe r${summary.wireframe_revision}` : ''}
                </p>
                {v.note && <p>“{v.note}”</p>}
                {v.reopened_at && (
                  <p className="muted">
                    Reopened by {v.reopened_by} on {new Date(v.reopened_at).toLocaleString()}: {v.reopen_reason}
                  </p>
                )}
              </div>
              <VersionDownloads project={project} version={v} />
            </li>
          )
        })}
      </ol>
    </section>
  )
}

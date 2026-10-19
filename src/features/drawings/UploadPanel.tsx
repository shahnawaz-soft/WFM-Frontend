import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type DragEvent } from 'react'

import { getUploadLimits, uploadDrawingSet } from '../../api/drawings'
import { toApiError } from '../../api/errors'
import type { Project } from '../../api/types'
import { notify } from '../../components/feedback/toastStore'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { FormAlert } from '../../components/ui/Field'
import { precheck } from './status'

interface Duplicate {
  file: File
  message: string
}

export function UploadPanel({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const limits = useQuery({ queryKey: ['upload-limits'], queryFn: getUploadLimits, staleTime: Infinity })
  const [progress, setProgress] = useState<number | null>(null)
  const [uploadingName, setUploadingName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [duplicate, setDuplicate] = useState<Duplicate | null>(null)
  const [dragging, setDragging] = useState(false)
  const busy = progress !== null

  async function start(file: File, confirmDuplicate = false) {
    if (!limits.data) return
    const problem = precheck(file, limits.data)
    if (problem) return setError(problem)

    setError(null)
    setDuplicate(null)
    setUploadingName(file.name)
    setProgress(0)
    abortRef.current = new AbortController()
    try {
      const created = await uploadDrawingSet(project.id, file, {
        confirmDuplicate,
        onProgress: setProgress,
        signal: abortRef.current.signal,
      })
      notify.success('Drawing set uploaded', `${created.page_count} pages are being prepared.`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project', project.id, 'drawing-sets'] }),
        queryClient.invalidateQueries({ queryKey: ['projects'] }),
      ])
    } catch (err) {
      const apiError = toApiError(err)
      if (abortRef.current?.signal.aborted) {
        notify.info('Upload cancelled')
      } else if (apiError.code === 'duplicate_drawing_set') {
        setDuplicate({ file, message: apiError.message })
      } else {
        setError(apiError.message)
      }
    } finally {
      setProgress(null)
      setUploadingName(null)
      abortRef.current = null
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    setDragging(false)
    const files = Array.from(event.dataTransfer.files)
    if (files.length > 1) return setError('Upload one drawing set at a time.')
    if (files[0] && !busy) void start(files[0])
  }

  const hintId = 'upload-limits-hint'
  return (
    <div className="upload">
      <div
        className="upload__zone"
        data-dragging={dragging || undefined}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {busy ? (
          <div className="upload__progress">
            <p>
              Uploading <strong>{uploadingName}</strong>…
            </p>
            <div
              className="progress"
              role="progressbar"
              aria-label={`Uploading ${uploadingName}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((progress ?? 0) * 100)}
            >
              <div className="progress__bar" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <p className="muted" aria-hidden="true">
              {Math.round((progress ?? 0) * 100)}%{progress === 1 ? ' — checking the file…' : ''}
            </p>
            <Button onClick={() => abortRef.current?.abort()}>Cancel upload</Button>
          </div>
        ) : (
          <>
            <p className="upload__title">Drag a drawing set here, or</p>
            <Button
              variant="primary"
              onClick={() => inputRef.current?.click()}
              disabled={!limits.data}
              aria-describedby={hintId}
            >
              Choose PDF…
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept={limits.data?.allowed_extensions.map((e) => `.${e}`).join(',') ?? '.pdf'}
              className="visually-hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void start(file)
              }}
            />
          </>
        )}
      </div>

      {limits.data && (
        <div id={hintId} className="upload__limits">
          <p>
            <strong>Supported:</strong> {limits.data.allowed_extensions.map((e) => `.${e.toUpperCase()}`).join(', ')}{' '}
            · up to {limits.data.max_upload_mb} MB · up to {limits.data.max_pages} pages per set.
          </p>
          <ul>
            {limits.data.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <FormAlert message={error} />

      <ConfirmDialog
        open={duplicate !== null}
        title="This file is already in the project"
        confirmLabel="Upload anyway"
        tone="primary"
        onConfirm={() => duplicate && void start(duplicate.file, true)}
        onCancel={() => setDuplicate(null)}
      >
        <p>{duplicate?.message}</p>
        <p>Uploading again keeps both copies as separate drawing sets. Nothing is replaced.</p>
      </ConfirmDialog>
    </div>
  )
}

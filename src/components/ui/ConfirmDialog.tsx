import type { ReactNode } from 'react'

import { Button } from './Button'
import { Dialog } from './Dialog'
import { FormAlert } from './Field'

interface ConfirmDialogProps {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  tone?: 'primary' | 'danger'
  pending?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

/** Explicit confirmation for consequential actions (archive, remove member). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  pending = false,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()} title={title}>
      <FormAlert message={error} />
      <div className="dialog__body">{children}</div>
      <div className="button-row">
        <Button variant={tone} loading={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </Dialog>
  )
}

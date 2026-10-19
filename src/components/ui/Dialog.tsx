import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
}

/** Accessible modal: focus trap, Escape to close, focus returns to the trigger. */
export function Dialog({ open, onOpenChange, title, description, children }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className="dialog">
          <DialogPrimitive.Title className="dialog__title">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="dialog__description">
              {description}
            </DialogPrimitive.Description>
          ) : (
            <DialogPrimitive.Description className="visually-hidden">{title}</DialogPrimitive.Description>
          )}
          {children}
          <DialogPrimitive.Close className="dialog__close" aria-label="Close">
            ×
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

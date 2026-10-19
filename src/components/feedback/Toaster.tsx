import * as ToastPrimitive from '@radix-ui/react-toast'
import { useSyncExternalStore } from 'react'

import { StatusIcon } from '../ui/StatusIcon'
import { toastStore, type ToastTone } from './toastStore'

const TONE_LABEL: Record<ToastTone, string> = {
  success: 'Success',
  error: 'Error',
  info: 'Notice',
}

/** Renders queued notifications. Errors stay until dismissed; others auto-close. */
export function Toaster() {
  const toasts = useSyncExternalStore(toastStore.subscribe, toastStore.getSnapshot)

  return (
    <ToastPrimitive.Provider swipeDirection="right" label="Notifications">
      {toasts.map((toast) => (
        <ToastPrimitive.Root
          key={toast.id}
          className={`toast toast--${toast.tone}`}
          type={toast.tone === 'error' ? 'foreground' : 'background'}
          duration={toast.tone === 'error' ? Infinity : 5000}
          onOpenChange={(open) => {
            if (!open) toastStore.dismiss(toast.id)
          }}
        >
          <StatusIcon tone={toast.tone} />
          <div className="toast__body">
            <ToastPrimitive.Title className="toast__title">
              <span className="visually-hidden">{TONE_LABEL[toast.tone]}: </span>
              {toast.title}
            </ToastPrimitive.Title>
            {toast.description && (
              <ToastPrimitive.Description className="toast__description">
                {toast.description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close className="toast__close" aria-label="Dismiss notification">
            ×
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="toast-viewport" />
    </ToastPrimitive.Provider>
  )
}

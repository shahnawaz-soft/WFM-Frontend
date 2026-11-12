/**
 * Framework-free notification store. Lets non-React code (e.g. the TanStack Query cache's
 * global error handler) raise notifications; <Toaster> renders them.
 */
export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

/** How long a notification shows (ms): a short success ("Level saved") just confirms, so it goes
 * within a second; one with details stays to be read; errors stay until dismissed. */
export function toastDuration(toast: Toast): number {
  if (toast.tone === 'error') return Infinity
  return toast.tone === 'success' && !toast.description ? 1000 : 4000
}

type Listener = () => void

let toasts: readonly Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  listeners.forEach((listener) => listener())
}

export const toastStore = {
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  getSnapshot(): readonly Toast[] {
    return toasts
  },
  show(toast: Omit<Toast, 'id'>): number {
    const id = nextId++
    // The same message again replaces the one showing (saving twice shows one "Level saved").
    const others = toasts.filter(
      (t) => !(t.tone === toast.tone && t.title === toast.title && t.description === toast.description),
    )
    toasts = [...others, { ...toast, id }].slice(-5)
    emit()
    return id
  },
  dismiss(id: number) {
    toasts = toasts.filter((t) => t.id !== id)
    emit()
  },
  clear() {
    toasts = []
    emit()
  },
}

export const notify = {
  success: (title: string, description?: string) =>
    toastStore.show({ tone: 'success', title, description }),
  error: (title: string, description?: string) =>
    toastStore.show({ tone: 'error', title, description }),
  info: (title: string, description?: string) =>
    toastStore.show({ tone: 'info', title, description }),
}

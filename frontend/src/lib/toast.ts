import { create } from 'zustand'

export type ToastTone = 'error' | 'success' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

interface ToastState {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: number) => void
}

const TOAST_DURATION_MS = 5000
const MAX_TOASTS = 4
let nextId = 1

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (tone, message) => {
    // The same failure reported by several queries at once shows up once.
    if (get().toasts.some((t) => t.message === message)) return
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, tone, message }].slice(-MAX_TOASTS) }))
    setTimeout(() => get().dismiss(id), TOAST_DURATION_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  error: (message: string) => useToastStore.getState().push('error', message),
  success: (message: string) => useToastStore.getState().push('success', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}

/** Pointer presses that landed on a toast. Dialogs check this to ignore them as "clicks
 * outside": Radix reports the outside press only after it's over, by when a dismissed
 * toast is already gone from the DOM (so its target can't be inspected any more). */
export const toastPointerEvents = new WeakSet<Event>()

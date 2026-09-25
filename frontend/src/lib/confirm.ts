import { create } from 'zustand'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  /** Styles the confirm button as destructive. */
  danger?: boolean
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (ok: boolean) => void }) | null
  open: (options: ConfirmOptions) => Promise<boolean>
  settle: (ok: boolean) => void
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  open: (options) =>
    new Promise<boolean>((resolve) => {
      get().request?.resolve(false) // a newer request replaces an unanswered one
      set({ request: { ...options, resolve } })
    }),
  settle: (ok) => {
    get().request?.resolve(ok)
    set({ request: null })
  },
}))

/** Promise-based replacement for window.confirm(), rendered in the app's own dialog
 * style by <ConfirmHost/>. Resolves true only if the user confirms. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().open(options)
}

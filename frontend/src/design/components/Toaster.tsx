import { clsx } from 'clsx'
import { AlertTriangle, Check, X } from '@/design/icons'
import { toastPointerEvents, useToastStore } from '@/lib/toast'

/** Bottom-of-screen notifications for background failures (a save or action that went
 * wrong without a form of its own to show the error in). */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  return (
    <div
      aria-live="polite"
      data-toaster
      onPointerDownCapture={(e) => toastPointerEvents.add(e.nativeEvent)}
      // Top on phones, where the bottom is taken by dialog sheets and their buttons.
      className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-center gap-2 sm:inset-x-auto sm:top-auto sm:bottom-4 sm:right-4 sm:items-end"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={clsx(
            'pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-md border bg-surface-raised px-3 py-2.5 text-sm text-text shadow-(--shadow-popover) animate-fade-in',
            t.tone === 'error' ? 'border-danger' : 'border-border',
          )}
        >
          {t.tone === 'error' ? (
            <AlertTriangle size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-danger" />
          ) : (
            <Check size={16} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
          )}
          <p className="flex-1">{t.message}</p>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss"
            className="-m-1 rounded p-1 text-text-muted hover:text-text"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      ))}
    </div>
  )
}

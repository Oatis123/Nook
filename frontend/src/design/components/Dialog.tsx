import { type ReactNode, useRef } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from '@/design/icons'
import { focusReturnFallback } from '@/lib/focusReturn'
import { toastPointerEvents } from '@/lib/toast'

interface DialogProps {
  /** Omit for a fully controlled dialog (opened programmatically via `open`/`onOpenChange`). */
  trigger?: ReactNode
  title: string
  description?: string
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** false: a choice is required — no close button, Esc and outside clicks do nothing. */
  dismissible?: boolean
}

export function Dialog({
  trigger,
  title,
  description,
  children,
  open,
  onOpenChange,
  dismissible = true,
}: DialogProps) {
  // Dialogs opened programmatically (no trigger) put focus back where it was when they
  // opened — Radix can only do that for its own trigger — so keyboard users aren't
  // dropped at the top of the page.
  const returnFocusRef = useRef<HTMLElement | null>(null)

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay fixed inset-0 z-50 bg-(--overlay) animate-fade-in" />
        <RadixDialog.Content
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={(e) => {
            // Dismissing a toast (e.g. the error from this very dialog's submit) must
            // not close the dialog and throw away what was typed in it.
            const onToast = toastPointerEvents.has(e.detail.originalEvent)
            if (!dismissible || onToast) e.preventDefault()
          }}
          onOpenAutoFocus={(e) => {
            returnFocusRef.current = document.activeElement as HTMLElement | null
            // An element marked data-autofocus (the confirm button, the first field)
            // gets focus instead of the close button.
            const preferred = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-autofocus]',
            )
            if (preferred) {
              e.preventDefault()
              preferred.focus()
            }
          }}
          onCloseAutoFocus={(e) => {
            if (trigger) return
            const target = returnFocusRef.current?.isConnected
              ? returnFocusRef.current
              : focusReturnFallback()
            if (target && target !== document.body) {
              e.preventDefault()
              target.focus()
            }
          }}
          className={[
            'ui-dialog fixed z-50 overflow-y-auto overscroll-contain border border-border bg-surface-raised p-5 shadow-(--shadow-dialog) animate-fade-in',
            // Phones: a bottom sheet that never runs off-screen — a tall form (e.g. a
            // recurring task) scrolls inside it instead of losing its header and buttons.
            'inset-x-0 bottom-0 max-h-[calc(100dvh-1rem)] rounded-t-(--radius-dialog) pb-[max(1.25rem,env(safe-area-inset-bottom))]',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[90vw] sm:max-w-md sm:max-h-[calc(100dvh-2rem)]',
            'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-(--radius-dialog) sm:pb-5',
          ].join(' ')}
        >
          <div className="ui-dialog-header mb-3 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="ui-dialog-title font-serif text-lg text-text">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            {dismissible && (
              <RadixDialog.Close asChild>
                <button
                  aria-label="Close"
                  className="ui-dialog-close rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
                >
                  <X size={16} strokeWidth={1.5} />
                </button>
              </RadixDialog.Close>
            )}
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

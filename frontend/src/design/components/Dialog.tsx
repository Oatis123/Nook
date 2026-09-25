import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from '@/design/icons'

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
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="ui-dialog-overlay fixed inset-0 z-50 bg-(--overlay) animate-fade-in" />
        <RadixDialog.Content
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          className={[
            'ui-dialog fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-(--radius-dialog) border border-border bg-surface-raised p-5 shadow-(--shadow-dialog)',
            'animate-fade-in',
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

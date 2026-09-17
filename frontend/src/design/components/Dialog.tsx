import type { ReactNode } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'

interface DialogProps {
  /** Omit for a fully controlled dialog (opened programmatically via `open`/`onOpenChange`). */
  trigger?: ReactNode
  title: string
  description?: string
  children?: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function Dialog({ trigger, title, description, children, open, onOpenChange }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RadixDialog.Trigger asChild>{trigger}</RadixDialog.Trigger>}
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <RadixDialog.Content
          className={[
            'fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-md -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-border bg-surface-raised p-5 shadow-(--shadow-popover)',
            'animate-fade-in',
          ].join(' ')}
        >
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <RadixDialog.Title className="font-serif text-lg text-text">
                {title}
              </RadixDialog.Title>
              {description && (
                <RadixDialog.Description className="mt-1 text-sm text-text-muted">
                  {description}
                </RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <button
                aria-label="Close"
                className="rounded-md p-1 text-text-muted hover:bg-surface hover:text-text"
              >
                <X size={16} strokeWidth={1.5} />
              </button>
            </RadixDialog.Close>
          </div>
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

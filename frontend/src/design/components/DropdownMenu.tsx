import type { ReactNode } from 'react'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { clsx } from 'clsx'

export interface DropdownMenuItem {
  label: string
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
}

export function DropdownMenu({
  trigger,
  items,
}: {
  trigger: ReactNode
  items: DropdownMenuItem[]
}) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger asChild>{trigger}</RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content
          align="start"
          sideOffset={6}
          className={[
            'ui-menu z-50 min-w-40 rounded-md border border-border bg-surface-raised p-1',
            'shadow-(--shadow-popover) animate-fade-in',
          ].join(' ')}
        >
          {items.map((item) => (
            <RadixDropdown.Item
              key={item.label}
              disabled={item.disabled}
              data-danger={item.danger || undefined}
              onSelect={item.onSelect}
              className={clsx(
                'ui-menu-item cursor-pointer rounded px-2.5 py-1.5 text-sm outline-none',
                'data-[highlighted]:bg-surface',
                item.danger ? 'text-danger' : 'text-text',
                item.disabled && 'opacity-50',
              )}
            >
              {item.label}
            </RadixDropdown.Item>
          ))}
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  )
}

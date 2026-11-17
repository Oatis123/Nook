import type { ComponentType } from 'react'
import type { MenuItemProps } from '@radix-ui/react-menu'
import { clsx } from 'clsx'
import type { AppIcon } from '@/design/icons'

export interface MenuAction {
  label: string
  icon?: AppIcon
  onSelect?: () => void
  danger?: boolean
  disabled?: boolean
  key?: string
}

export const menuClass =
  'ui-menu ui-glass z-50 max-h-[var(--radix-dropdown-menu-content-available-height,var(--radix-context-menu-content-available-height,75dvh))] min-w-40 overflow-y-auto border border-border bg-surface-raised p-1 animate-fade-in'

export function MenuItems({
  as: Item,
  items,
}: {
  as: ComponentType<MenuItemProps>
  items: MenuAction[]
}) {
  return items.map(({ key, label, icon: Icon, onSelect, danger, disabled }) => (
    <Item
      key={key ?? label}
      disabled={disabled}
      data-danger={danger || undefined}
      onSelect={onSelect}
      className={clsx(
        'ui-menu-item flex cursor-pointer items-center gap-2 px-2.5 py-1.5 text-sm outline-none',
        danger ? 'text-danger' : 'text-text',
        disabled && 'opacity-50',
      )}
    >
      {Icon && <Icon size={16} />}
      {label}
    </Item>
  ))
}

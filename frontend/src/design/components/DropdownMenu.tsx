import type { ReactNode } from 'react'
import * as RadixDropdown from '@radix-ui/react-dropdown-menu'
import { MenuItems, menuClass, type MenuAction } from '@/design/components/MenuItems'
import { rememberMenuTrigger } from '@/lib/focusReturn'

export type DropdownMenuItem = MenuAction

export function DropdownMenu({
  trigger,
  items,
}: {
  trigger: ReactNode
  items: DropdownMenuItem[]
}) {
  return (
    <RadixDropdown.Root>
      <RadixDropdown.Trigger
        asChild
        onPointerDown={(e) => rememberMenuTrigger(e.currentTarget as HTMLElement)}
        onKeyDown={(e) => rememberMenuTrigger(e.currentTarget as HTMLElement)}
      >
        {trigger}
      </RadixDropdown.Trigger>
      <RadixDropdown.Portal>
        <RadixDropdown.Content align="start" sideOffset={6} className={menuClass}>
          <MenuItems as={RadixDropdown.Item} items={items} />
        </RadixDropdown.Content>
      </RadixDropdown.Portal>
    </RadixDropdown.Root>
  )
}

import type { ReactNode } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { clsx } from 'clsx'

export interface TabItem {
  value: string
  label: string
  content: ReactNode
}

export function Tabs({ items, defaultValue }: { items: TabItem[]; defaultValue?: string }) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? items[0]?.value}>
      <RadixTabs.List className="ui-tabs-list flex gap-1 border-b border-border">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className={clsx(
              'ui-tab border-b-2 border-transparent px-3 py-2 text-sm text-text-muted',
              'transition-colors duration-150 hover:text-text',
              'data-[state=active]:border-accent data-[state=active]:text-text',
            )}
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content key={item.value} value={item.value} className="pt-4">
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  )
}

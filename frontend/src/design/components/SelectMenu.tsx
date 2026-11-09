import type { CSSProperties } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown } from '@/design/icons'
import { menuClass } from '@/design/components/MenuItems'

export function SelectMenu<Value extends string>({
  label,
  value,
  options,
  onChange,
  style,
}: {
  label: string
  value: Value | undefined
  options: { value: Value; label: string }[]
  onChange: (value: Value) => void
  style?: CSSProperties
}) {
  const selected = options.find((option) => option.value === value)

  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={selected ? `${label}: ${selected.label}` : label}
          className="ui-field-trigger flex h-9 min-w-0 max-w-full items-center gap-1.5 border px-2 text-sm"
          style={style}
        >
          <span className="truncate">{selected?.label ?? label}</span>
          <ChevronsUpDown size={14} />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className={`${menuClass} max-h-(--radix-dropdown-menu-content-available-height) max-w-[calc(100vw-1rem)] overflow-y-auto`}
        >
          <Dropdown.RadioGroup value={value}>
            {options.map((option) => (
              <Dropdown.RadioItem
                key={option.value}
                value={option.value}
                onSelect={() => onChange(option.value)}
                className="ui-menu-item relative flex min-h-9 cursor-pointer items-center py-1.5 pr-2.5 pl-8 text-sm break-words outline-none"
              >
                <Dropdown.ItemIndicator className="absolute left-2.5 text-accent">
                  <Check size={15} />
                </Dropdown.ItemIndicator>
                {option.label}
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

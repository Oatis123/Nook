import { type ComponentPropsWithoutRef, useMemo, useRef, useState } from 'react'
import * as Menu from '@radix-ui/react-menu'
import { MenuItems, menuClass, type MenuAction } from '@/design/components/MenuItems'
import { rememberMenuTrigger } from '@/lib/focusReturn'

type MenuPoint = { x: number; y: number }

function PointMenu({
  point,
  label,
  items,
  trigger,
  onClose,
}: {
  point: MenuPoint
  label: string
  items: MenuAction[]
  trigger: HTMLElement
  onClose: () => void
}) {
  const outside = useRef(false)
  const anchor = useMemo(
    () => ({ current: { getBoundingClientRect: () => DOMRect.fromRect(point) } }),
    [point],
  )

  return (
    <Menu.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Menu.Anchor virtualRef={anchor} />
      <Menu.Portal>
        <Menu.Content
          aria-label={label}
          className={`${menuClass} max-h-(--radix-popper-available-height) overflow-y-auto`}
          side="right"
          align="start"
          sideOffset={2}
          collisionPadding={8}
          loop
          onContextMenu={(event) => event.preventDefault()}
          onInteractOutside={() => {
            outside.current = true
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            // Leave focus with an outside click or an action that opened a dialog or input.
            if (!outside.current && document.activeElement === document.body) trigger.focus()
          }}
        >
          <MenuItems as={Menu.Item} items={items} />
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

/** A normal row that opens its actions at the pointer or from the focused control. */
export function RowContextMenu({
  label,
  items,
  menuDisabled,
  ...props
}: Omit<ComponentPropsWithoutRef<'div'>, 'onContextMenu' | 'onKeyDown'> & {
  label: string
  items: MenuAction[]
  menuDisabled?: boolean
}) {
  const [menu, setMenu] = useState<(MenuPoint & { trigger: HTMLElement }) | null>(null)

  function show(point: MenuPoint, trigger: HTMLElement) {
    rememberMenuTrigger(trigger)
    setMenu({ ...point, trigger })
  }

  return (
    <>
      <div
        {...props}
        onContextMenu={(event) => {
          const row = event.currentTarget
          const target = event.target as Element
          if (
            menuDisabled ||
            !row.contains(target) ||
            ('pointerType' in event.nativeEvent && event.nativeEvent.pointerType === 'touch') ||
            target.closest('input, textarea, select, [contenteditable]')
          )
            return
          event.preventDefault()
          show(
            { x: event.clientX, y: event.clientY },
            row.querySelector<HTMLElement>('.row-link') ?? row,
          )
        }}
        onKeyDown={(event) => {
          if (
            menuDisabled ||
            (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
          )
            return
          const target = event.target as HTMLElement
          if (
            !event.currentTarget.contains(target) ||
            target.closest('input, textarea, select, [contenteditable]')
          )
            return
          event.preventDefault()
          const rect = target.getBoundingClientRect()
          show({ x: rect.left, y: rect.bottom }, target)
        }}
      />
      {menu && (
        <PointMenu
          point={menu}
          trigger={menu.trigger}
          label={label}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

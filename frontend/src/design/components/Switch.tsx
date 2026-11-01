import * as RadixSwitch from '@radix-ui/react-switch'

/** An on/off switch drawn the oatis way: an `on off` text pair with the current one
 * filled (design/skins/oatis.css `.ui-toggle`). Still a Radix switch underneath, so it
 * keeps role="switch", aria-checked and keyboard toggling. */
export function Switch({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
}) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      aria-label={label}
      className="ui-toggle shrink-0"
    >
      <span data-part="on" aria-hidden>
        on
      </span>
      <span data-part="off" aria-hidden>
        off
      </span>
    </RadixSwitch.Root>
  )
}

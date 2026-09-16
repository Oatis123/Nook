import * as RadixSwitch from '@radix-ui/react-switch'

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
      className={[
        'relative h-5 w-9 shrink-0 rounded-full border border-border bg-surface',
        'transition-colors duration-150 data-[state=checked]:bg-accent data-[state=checked]:border-accent',
      ].join(' ')}
    >
      <RadixSwitch.Thumb
        className={[
          'block h-3.5 w-3.5 translate-x-0.5 rounded-full bg-surface-raised',
          'transition-transform duration-150 data-[state=checked]:translate-x-[18px]',
        ].join(' ')}
      />
    </RadixSwitch.Root>
  )
}

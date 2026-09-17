import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, className, children, ...props }, ref) => (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      className={clsx(
        // 44px below md (spec §10.8 touch-target minimum); the tighter 36px desktop
        // size stays so toolbars with several icon buttons in a row don't bloat.
        'inline-flex h-11 w-11 items-center justify-center rounded-md text-text-muted md:h-9 md:w-9',
        'transition-colors duration-150 hover:bg-surface hover:text-text',
        'disabled:opacity-50 disabled:pointer-events-none',
        active && 'bg-surface text-text',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  ),
)
IconButton.displayName = 'IconButton'

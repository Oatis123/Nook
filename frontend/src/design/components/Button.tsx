import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { clsx } from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-accent text-accent-text hover:opacity-90',
  secondary: 'bg-surface-raised text-text border border-border hover:bg-surface',
  ghost: 'text-text hover:bg-surface',
  danger: 'bg-danger text-danger-text hover:opacity-90',
}

// 44px tall below md (spec §10.8 touch-target minimum), tighter on desktop.
const sizeClasses: Record<Size, string> = {
  sm: 'h-11 px-3 text-sm gap-1.5 md:h-8',
  md: 'h-11 px-4 text-sm gap-2 md:h-10',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className, ...props }, ref) => (
    <button
      ref={ref}
      className={clsx(
        'inline-flex items-center justify-center rounded-md font-medium',
        'transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'

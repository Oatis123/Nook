import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  action,
}: {
  icon: LucideIcon
  title: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Icon size={28} strokeWidth={1.5} className="text-text-muted" />
      <p className="text-sm text-text-muted">{title}</p>
      {action}
    </div>
  )
}

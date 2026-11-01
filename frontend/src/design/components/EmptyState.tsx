import type { ReactNode } from 'react'
import { Vivi } from '@/design/components/Vivi'

/** oatis-style empty state: Vivi (asleep when there's simply nothing here, glitching when
 * something is broken or missing), one sentence in the book serif, and at most one action. */
export function EmptyState({
  title,
  action,
  mood = 'sleep',
}: {
  title: string
  action?: ReactNode
  mood?: 'sleep' | 'glitch'
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Vivi state={mood} />
      <p className="max-w-[40ch] font-(family-name:--font-prose) text-[0.95rem] leading-relaxed text-text-muted">
        {title}
      </p>
      {action}
    </div>
  )
}

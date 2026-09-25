import type { ReactNode } from 'react'
import { AlertTriangle } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { EmptyState } from '@/design/components/EmptyState'
import { errorMessage } from '@/lib/errors'

interface QueryLike {
  isError: boolean
  error: unknown
  refetch: () => unknown
}

/** What a page shows before its data is there: a quiet loading line, or — instead of a
 * blank page forever — the error with a retry button. */
export function QueryState({ query, compact }: { query: QueryLike; compact?: boolean }) {
  if (query.isError) {
    const retry: ReactNode = (
      <Button variant="secondary" onClick={() => query.refetch()}>
        Retry
      </Button>
    )
    if (compact) {
      return (
        <div role="alert" className="flex flex-col items-start gap-2 px-3 py-2 text-sm">
          <p className="text-text-muted">{errorMessage(query.error)}</p>
          {retry}
        </div>
      )
    }
    return <EmptyState icon={AlertTriangle} title={errorMessage(query.error)} action={retry} />
  }
  return (
    <p
      role="status"
      className={compact ? 'px-3 py-2 text-sm text-text-muted' : 'p-6 text-sm text-text-muted'}
    >
      Loading…
    </p>
  )
}

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AlertTriangle } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { EmptyState } from '@/design/components/EmptyState'
import { useCurrentUser } from '@/features/auth/hooks'
import { TelegramGate } from '@/features/auth/TelegramGate'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'

function ServerUnreachable({ error, retry }: { error: unknown; retry: () => unknown }) {
  return (
    <div className="h-dvh bg-bg">
      <EmptyState
        icon={AlertTriangle}
        title={errorMessage(error)}
        action={
          <Button variant="secondary" onClick={() => retry()}>
            Retry
          </Button>
        }
      />
    </div>
  )
}

/** Where to come back to after signing in again (see LoginPage). */
function useLoginRedirect(): string {
  const location = useLocation()
  const here = location.pathname + location.search
  return here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`
}

function isSignedOut(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401
}

export function RequireAuth() {
  const { data: user, isLoading, isError, error, refetch } = useCurrentUser()
  const loginUrl = useLoginRedirect()

  if (isLoading) return null
  // No cached user and the API isn't answering: don't bounce to /login (signing in
  // would fail the same way) — say what's wrong and keep retrying.
  if (!user && isError && !isSignedOut(error)) {
    return <ServerUnreachable error={error} retry={refetch} />
  }
  if (!user) return <Navigate to={loginUrl} replace />
  if (!user.telegram_linked) return <TelegramGate />

  return <Outlet />
}

export function RequireAdmin() {
  const { data: user, isLoading } = useCurrentUser()
  const loginUrl = useLoginRedirect()

  if (isLoading) return null
  if (!user) return <Navigate to={loginUrl} replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />

  return <Outlet />
}

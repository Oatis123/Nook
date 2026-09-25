import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { AlertTriangle } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { errorMessage, isConnectionError, isStaleChunkError } from '@/lib/errors'

/** Router-level error boundary: replaces React Router's developer error page ("Hey
 * developer 👋", stack trace) with something a user can act on. */
export function RouteError() {
  const error = useRouteError()
  const notFound = isRouteErrorResponse(error) && error.status === 404

  let message = 'Something went wrong while showing this page.'
  if (notFound) message = "This page doesn't exist."
  else if (isStaleChunkError(error))
    message = 'A new version of the app is available. Reload to continue.'
  else if (isConnectionError(error)) message = errorMessage(error)

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6 text-center">
      <AlertTriangle size={28} strokeWidth={1.5} className="text-text-muted" />
      <p className="max-w-sm text-sm text-text">{message}</p>
      <div className="flex gap-2">
        {!notFound && (
          <Button variant="primary" onClick={() => window.location.reload()}>
            Try again
          </Button>
        )}
        <Button variant="secondary" onClick={() => window.location.assign('/')}>
          Go to start
        </Button>
      </div>
      {import.meta.env.DEV && error instanceof Error && (
        <pre className="max-w-full overflow-auto text-left text-xs text-text-muted">
          {error.stack}
        </pre>
      )}
    </div>
  )
}

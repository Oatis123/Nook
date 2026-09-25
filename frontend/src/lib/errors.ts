import { ApiError } from '@/lib/api'

/** A user-facing sentence for any error a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // The API's own 413s explain themselves (size limit, storage quota); nginx's don't.
    if (error.status === 413) {
      return error.code !== 'error' ? error.message : 'That file is too large to upload.'
    }
    if (error.status === 429) return 'Too many requests — wait a minute and try again.'
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return 'The server is unavailable right now. Please try again in a moment.'
    }
    if (error.status >= 500) return 'Something went wrong on the server. Please try again.'
    return error.message || 'Request failed.'
  }
  if (isNetworkFailure(error)) {
    return "Can't reach the server. Check your connection and try again."
  }
  return 'Something went wrong. Please try again.'
}

/** Network failure or a gateway/server-down status — i.e. "not reachable", as opposed to
 * a real answer from the API. */
export function isConnectionError(error: unknown): boolean {
  if (isNetworkFailure(error)) return true
  return error instanceof ApiError && [502, 503, 504].includes(error.status)
}

/** fetch() rejects with a TypeError whose message depends on the browser. Other
 * TypeErrors are ordinary bugs and must not be reported as "can't reach the server". */
function isNetworkFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|networkerror|load failed|network request failed/i.test(error.message)
  )
}

/** A lazily loaded page chunk that no longer exists — the app was redeployed while this
 * tab was open, so the old build's file names are gone. */
export function isStaleChunkError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /dynamically imported module|importing a module script failed|error loading dynamically/i.test(
      error.message,
    )
  )
}

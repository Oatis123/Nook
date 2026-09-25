import { ApiError } from '@/lib/api'

/** A user-facing sentence for any error a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 413) return 'That file is too large to upload.'
    if (error.status === 429) return 'Too many requests — wait a minute and try again.'
    if (error.status === 502 || error.status === 503 || error.status === 504) {
      return 'The server is unavailable right now. Please try again in a moment.'
    }
    if (error.status >= 500) return 'Something went wrong on the server. Please try again.'
    return error.message || 'Request failed.'
  }
  if (error instanceof TypeError) {
    // fetch() rejects with a TypeError when the network request itself fails.
    return "Can't reach the server. Check your connection and try again."
  }
  return 'Something went wrong. Please try again.'
}

/** Network failure or a gateway/server-down status — i.e. "not reachable", as opposed to
 * a real answer from the API. */
export function isConnectionError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  return error instanceof ApiError && [502, 503, 504].includes(error.status)
}

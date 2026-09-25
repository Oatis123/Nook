export class ApiError extends Error {
  code: string
  details: unknown

  constructor(status: number, code: string, message: string, details: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }

  status: number
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Endpoints that are themselves part of signing in/out: a 401 from them is the answer,
 * not an expired session to refresh. */
const NO_REFRESH_PATH = /^\/auth\/(login|refresh|logout|invite|telegram|password-reset)/

interface RequestOptions {
  method?: string
  body?: unknown
}

let sessionExpiredHandler: (() => void) | null = null

/** Called once a request got a 401 and refreshing the session failed too — the app uses
 * it to drop the cached user, which sends the router to /login. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  sessionExpiredHandler = handler
}

let refreshInFlight: Promise<boolean> | null = null

/** The access cookie only lives 15 minutes; the long-lived refresh cookie renews it.
 * Single-flight: every request that hits a 401 at the same moment waits on one refresh
 * call instead of each rotating the refresh token (which would revoke the others'). */
export function refreshSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const csrf = readCookie('csrf_token')
        const response = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: csrf ? { 'x-csrf-token': csrf } : {},
          credentials: 'include',
        })
        return response.ok
      } catch {
        return false
      }
    })().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function send(path: string, init: () => RequestInit): Promise<Response> {
  const response = await fetch(`/api/v1${path}`, { credentials: 'include', ...init() })
  if (response.status !== 401 || NO_REFRESH_PATH.test(path)) return response

  // Retried either way: after our own refresh, or — when that failed — because another
  // tab may have rotated the refresh token (making ours stale) and set fresh cookies we
  // now share. init() is re-evaluated so the retry picks up the CSRF cookie as it is now.
  const refreshed = await refreshSession()
  const retry = await fetch(`/api/v1${path}`, { credentials: 'include', ...init() })
  if (!refreshed && retry.status === 401) sessionExpiredHandler?.()
  return retry
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : undefined

  if (!response.ok) {
    const error = payload?.error ?? { code: 'error', message: response.statusText }
    throw new ApiError(response.status, error.code, error.message, error.details)
  }

  return payload as T
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body ? 'POST' : 'GET')

  const response = await send(path, () => {
    const headers: Record<string, string> = {}
    if (options.body !== undefined) headers['content-type'] = 'application/json'
    if (MUTATING_METHODS.has(method)) {
      const csrf = readCookie('csrf_token')
      if (csrf) headers['x-csrf-token'] = csrf
    }
    return {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    }
  })
  return parse<T>(response)
}

/** Multipart upload — apiFetch always JSON-encodes its body, which doesn't fit a File;
 * this skips the content-type header entirely so the browser sets the multipart boundary. */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const response = await send(path, () => {
    const headers: Record<string, string> = {}
    const csrf = readCookie('csrf_token')
    if (csrf) headers['x-csrf-token'] = csrf
    const formData = new FormData()
    formData.append('file', file)
    return { method: 'POST', headers, body: formData }
  })
  return parse<T>(response)
}

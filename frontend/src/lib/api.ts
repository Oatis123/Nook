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

interface RequestOptions {
  method?: string
  body?: unknown
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? (options.body ? 'POST' : 'GET')
  const headers: Record<string, string> = {}

  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (MUTATING_METHODS.has(method)) {
    const csrf = readCookie('csrf_token')
    if (csrf) headers['x-csrf-token'] = csrf
  }

  const response = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (response.status === 204) return undefined as T

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : undefined

  if (!response.ok) {
    const error = payload?.error ?? { code: 'error', message: response.statusText }
    throw new ApiError(response.status, error.code, error.message, error.details)
  }

  return payload as T
}

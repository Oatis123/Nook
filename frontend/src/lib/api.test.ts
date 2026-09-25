import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, setSessionExpiredHandler } from '@/lib/api'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('apiFetch session refresh', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    setSessionExpiredHandler(null)
  })

  it('refreshes once for concurrent 401s and retries each request', async () => {
    let sessionValid = false
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        await new Promise((r) => setTimeout(r, 10))
        sessionValid = true
        return json(200, {})
      }
      return sessionValid ? json(200, { url }) : json(401, { error: { code: 'unauthorized' } })
    })

    const results = await Promise.all([apiFetch('/notes'), apiFetch('/tasks'), apiFetch('/me')])

    expect(results).toEqual([
      { url: '/api/v1/notes' },
      { url: '/api/v1/tasks' },
      { url: '/api/v1/me' },
    ])
    const refreshCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))
    expect(refreshCalls).toHaveLength(1)
  })

  it('reports an expired session when the refresh fails too', async () => {
    const onExpired = vi.fn()
    setSessionExpiredHandler(onExpired)
    fetchMock.mockImplementation(async () =>
      json(401, { error: { code: 'unauthorized', message: 'Not authenticated' } }),
    )

    await expect(apiFetch('/notes')).rejects.toBeInstanceOf(ApiError)
    expect(onExpired).toHaveBeenCalledOnce()
  })

  it('does not try to refresh on a failed login', async () => {
    fetchMock.mockImplementation(async () =>
      json(401, { error: { code: 'unauthorized', message: 'Invalid credentials' } }),
    )

    await expect(apiFetch('/auth/login', { body: {} })).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

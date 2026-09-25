import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as notesApi from '@/features/notes/api'
import { SAVE_DEBOUNCE_MS, useNoteAutosave } from '@/features/notes/useNoteAutosave'
import { ApiError } from '@/lib/api'
import type { NoteDetail } from '@/lib/types'

vi.mock('@/features/notes/api', () => ({ updateNote: vi.fn(), getNote: vi.fn() }))

const updateNote = vi.mocked(notesApi.updateNote)

function note(overrides: Partial<NoteDetail> = {}): NoteDetail {
  return {
    id: 'a',
    folder_id: null,
    title: 'Note A',
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    deleted_at: null,
    content: 'Alpha',
    frontmatter: {},
    tags: [],
    aliases: [],
    linked_tasks: [],
    ...overrides,
  } as NoteDetail
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** A promise the test resolves by hand, to hold a save "in flight". */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('useNoteAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    updateNote.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('serializes saves and never overwrites text typed during a save', async () => {
    const first = deferred<NoteDetail>()
    updateNote.mockImplementationOnce(() => first.promise)
    updateNote.mockImplementationOnce(async (_id, input) =>
      note({ version: 3, content: input.content }),
    )
    const { result } = renderHook(() => useNoteAutosave('a', note()), { wrapper })

    act(() => result.current.setContent('Alpha 1'))
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS))
    expect(updateNote).toHaveBeenCalledTimes(1)

    // More typing while the first save is still in flight: no second request yet.
    act(() => result.current.setContent('Alpha 12'))
    await act(() => vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS))
    expect(updateNote).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve(note({ version: 2, content: 'Alpha 1' })))
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.draft?.content).toBe('Alpha 12')
    expect(updateNote).toHaveBeenCalledTimes(2)
    expect(updateNote.mock.calls[1]).toEqual(['a', { version: 2, content: 'Alpha 12' }])
    expect(result.current.status).toBe('saved')
  })

  it('flushes a pending save for its own note on unmount', async () => {
    updateNote.mockImplementation(async (_id, input) =>
      note({ version: 2, content: input.content }),
    )
    const { result, unmount } = renderHook(() => useNoteAutosave('a', note()), { wrapper })

    act(() => result.current.setContent('Alpha typed'))
    unmount() // e.g. clicking another note within the debounce window

    await vi.advanceTimersByTimeAsync(0)
    expect(updateNote).toHaveBeenCalledWith('a', { version: 1, content: 'Alpha typed' })
  })

  it('reports a duplicate title and still saves the content', async () => {
    updateNote.mockRejectedValueOnce(
      new ApiError(409, 'duplicate_title', 'A note with this title already exists', null),
    )
    updateNote.mockImplementationOnce(async (_id, input) =>
      note({ version: 2, content: input.content }),
    )
    const { result } = renderHook(() => useNoteAutosave('a', note()), { wrapper })

    act(() => {
      result.current.setContent('Alpha edited')
      result.current.setTitle('Taken')
      result.current.commitTitle(false)
    })
    await act(() => vi.advanceTimersByTimeAsync(0))

    expect(result.current.titleError).toMatch(/already exists/)
    expect(updateNote).toHaveBeenCalledTimes(2)
    expect(updateNote.mock.calls[1]).toEqual(['a', { version: 1, content: 'Alpha edited' }])
    expect(result.current.conflict).toBeNull()
  })

  it('keeps unsaved edits in localStorage and restores them on reopen', async () => {
    updateNote.mockRejectedValue(new TypeError('Failed to fetch'))
    const first = renderHook(() => useNoteAutosave('a', note()), { wrapper })
    act(() => first.result.current.setContent('Written offline'))
    first.unmount()
    await vi.advanceTimersByTimeAsync(0)

    updateNote.mockReset()
    updateNote.mockImplementation(async (_id, input) =>
      note({ version: 2, content: input.content }),
    )
    const second = renderHook(() => useNoteAutosave('a', note()), { wrapper })

    expect(second.result.current.draft?.content).toBe('Written offline')
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(updateNote).toHaveBeenCalledWith('a', { version: 1, content: 'Written offline' })
    expect(localStorage.getItem('nook:note-draft:a')).toBeNull()
  })

  it('asks to resolve when the stored draft is older than the server copy', () => {
    localStorage.setItem(
      'nook:note-draft:a',
      JSON.stringify({ content: 'Old local edit', baseVersion: 1 }),
    )
    const { result } = renderHook(
      () => useNoteAutosave('a', note({ version: 4, content: 'Newer on server' })),
      { wrapper },
    )
    expect(result.current.conflict?.content).toBe('Newer on server')
    expect(result.current.draft?.content).toBe('Old local edit')
    expect(updateNote).not.toHaveBeenCalled()
  })
})

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import * as notesApi from '@/features/notes/api'
import { noteKey } from '@/features/notes/hooks'
import { ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import { clearStoredDraft, readStoredDraft, writeStoredDraft } from '@/features/notes/draftStorage'
import type { NoteDetail } from '@/lib/types'

export const SAVE_DEBOUNCE_MS = 800
const RETRY_DELAY_MS = 10_000
const MAX_AUTO_RETRIES = 30

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'retrying' | 'conflict' | 'error'

interface Draft {
  title: string
  content: string
}

/**
 * Autosave for one note. The editor is mounted per note (keyed by id), so everything
 * here — refs, timers, the in-flight request — belongs to exactly one note and can never
 * write into another one.
 *
 * Saves are serialized: while one request is in flight, further edits only mark the
 * draft dirty, and the latest text is sent once it returns (with the version it
 * returned), so two overlapping saves can't 409 against each other. A response only
 * advances the known server version; it never overwrites the editor's text, so
 * characters typed during a save aren't lost. Content autosaves on a debounce; the title
 * is sent only when committed (blur/Enter) via `commitTitle`.
 */
export function useNoteAutosave(noteId: string, server: NoteDetail | undefined) {
  const queryClient = useQueryClient()
  const [draft, setDraftState] = useState<Draft | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflictState] = useState<NoteDetail | null>(null)
  const [titleError, setTitleError] = useState<string | null>(null)
  const [fatalError, setFatalError] = useState<string | null>(null)

  const draftRef = useRef<Draft | null>(null)
  const savedRef = useRef<Draft>({ title: '', content: '' })
  const versionRef = useRef(0)
  const pendingTitleRef = useRef<{ title: string; updateLinks: boolean } | null>(null)
  const inFlightRef = useRef(false)
  const conflictRef = useRef(false)
  const fatalRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveNowRef = useRef<() => Promise<void>>(async () => {})

  const setDraft = useCallback((next: Draft) => {
    draftRef.current = next
    setDraftState(next)
  }, [])

  const setConflict = useCallback((note: NoteDetail | null) => {
    conflictRef.current = note !== null
    setConflictState(note)
  }, [])

  const isDirty = useCallback(
    () =>
      draftRef.current !== null &&
      (draftRef.current.content !== savedRef.current.content || pendingTitleRef.current !== null),
    [],
  )

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (retryRef.current) clearTimeout(retryRef.current)
    timerRef.current = null
    retryRef.current = null
  }, [])

  // Automatic retries after a failed save: bounded, and never after the editor for this
  // note has unmounted (a leftover timer could otherwise race a newer editor instance).
  const retriesRef = useRef(0)
  const mountedRef = useRef(true)
  const scheduleRetry = useCallback((): boolean => {
    if (!mountedRef.current || retriesRef.current >= MAX_AUTO_RETRIES) return false
    retriesRef.current += 1
    retryRef.current = setTimeout(() => void saveNowRef.current(), RETRY_DELAY_MS)
    return true
  }, [])

  const saveNow = useCallback(async () => {
    clearTimers()
    if (inFlightRef.current || conflictRef.current || fatalRef.current) return
    const current = draftRef.current
    if (!current) return
    const titleCommit = pendingTitleRef.current
    const content = current.content
    const contentDirty = content !== savedRef.current.content
    if (!contentDirty && !titleCommit) {
      setStatus('saved')
      return
    }
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }

    inFlightRef.current = true
    pendingTitleRef.current = null
    setStatus('saving')
    let saveAgain = false
    try {
      const result = await notesApi.updateNote(noteId, {
        version: versionRef.current,
        ...(contentDirty ? { content } : {}),
        ...(titleCommit ? { title: titleCommit.title, update_links: titleCommit.updateLinks } : {}),
      })
      versionRef.current = result.version
      savedRef.current = { title: result.title, content: result.content }
      queryClient.setQueryData(noteKey(noteId), result)
      queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === 'tags' || (q.queryKey[0] === 'notes' && q.queryKey[1] !== noteId),
      })
      retriesRef.current = 0
      if (draftRef.current?.content === result.content) {
        clearStoredDraft(noteId)
      } else if (draftRef.current) {
        // Typing continued during the save: re-base the backup on the version just
        // saved, or restoring it later would look like a conflict with our own save.
        writeStoredDraft(noteId, { content: draftRef.current.content, baseVersion: result.version })
      }
      saveAgain = isDirty()
      setStatus(saveAgain ? 'saving' : 'saved')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        if (error.code === 'duplicate_title') {
          // The title is rejected, but the content in the same request still needs saving.
          setTitleError(error.message)
          saveAgain = contentDirty
          if (!contentDirty) setStatus('saved')
        } else if (error.code === 'note_in_trash') {
          fatalRef.current = true
          setFatalError('This note is in the trash. Restore it to keep editing.')
          setStatus('error')
        } else {
          if (titleCommit) pendingTitleRef.current = titleCommit
          try {
            const fresh = await notesApi.getNote(noteId)
            if (fresh.content === savedRef.current.content) {
              // Only metadata changed meanwhile (moved/renamed from the sidebar): the text
              // we based our edit on is intact, so adopt the new version and save again.
              versionRef.current = fresh.version
              savedRef.current = { title: fresh.title, content: fresh.content }
              queryClient.setQueryData(noteKey(noteId), fresh)
              saveAgain = true
            } else {
              setConflict(fresh)
              setStatus('conflict')
            }
          } catch {
            setStatus('retrying')
            scheduleRetry()
          }
        }
      } else if (error instanceof ApiError && error.status === 422) {
        // Rejected as invalid (in practice: over the size limit). Retrying the same text
        // can't succeed; the next edit tries again.
        if (titleCommit) pendingTitleRef.current = titleCommit
        setStatus('error')
        toast.error("This note couldn't be saved: it's over the 500,000-character limit.")
      } else {
        // Network error, 5xx, expired session…: keep the edits (they're in localStorage
        // too) and try again shortly; the next keystroke or reconnect also retries.
        // Other 4xx (the note is gone, access lost) won't fix themselves: no auto-retry.
        if (titleCommit) pendingTitleRef.current = titleCommit
        const transient =
          !(error instanceof ApiError) ||
          error.status >= 500 ||
          error.status === 408 ||
          error.status === 429
        if (!navigator.onLine) setStatus('offline')
        else setStatus(transient && scheduleRetry() ? 'retrying' : 'error')
      }
    } finally {
      inFlightRef.current = false
    }
    if (saveAgain) void saveNowRef.current()
  }, [clearTimers, isDirty, noteId, queryClient, scheduleRetry, setConflict])

  useEffect(() => {
    saveNowRef.current = saveNow
  }, [saveNow])

  const scheduleSave = useCallback((delay = SAVE_DEBOUNCE_MS) => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => void saveNowRef.current(), delay)
  }, [])

  // First load: start from the server copy — or from a newer local backup of it.
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!server || initializedRef.current) return
    initializedRef.current = true
    versionRef.current = server.version
    savedRef.current = { title: server.title, content: server.content }
    const stored = readStoredDraft(noteId)
    if (stored && stored.content !== server.content) {
      // Syncing from external sources (the query cache and localStorage) is what this
      // effect is for; it runs once per note.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft({ title: server.title, content: stored.content })
      if (stored.baseVersion === server.version) {
        setStatus('saving')
        scheduleSave(0)
      } else {
        // Local unsaved edits *and* newer changes on the server: let the user choose.
        setConflict(server)
        setStatus('conflict')
      }
    } else {
      if (stored) clearStoredDraft(noteId)
      setDraft({ title: server.title, content: server.content })
    }
  }, [server, noteId, scheduleSave, setConflict, setDraft])

  // Later server updates (background refetch, a move/rename from the sidebar, another
  // tab): adopt them when they don't touch the text being edited.
  useEffect(() => {
    if (!server || !initializedRef.current || inFlightRef.current) return
    if (server.version <= versionRef.current) return
    if (server.content === savedRef.current.content) {
      versionRef.current = server.version
      const current = draftRef.current
      if (current && current.title === savedRef.current.title && !pendingTitleRef.current) {
        setDraft({ ...current, title: server.title })
      }
      savedRef.current = { title: server.title, content: server.content }
    } else if (isDirty()) {
      setConflict(server)
      setStatus('conflict')
    } else {
      versionRef.current = server.version
      savedRef.current = { title: server.title, content: server.content }
      setDraft({ title: server.title, content: server.content })
    }
  }, [server, isDirty, setConflict, setDraft])

  useEffect(() => {
    function handleOnline() {
      if (isDirty()) void saveNowRef.current()
    }
    function handleOffline() {
      if (isDirty()) setStatus('offline')
    }
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty() || inFlightRef.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    // The page is going away (reload, closed tab, full navigation) with edits still in
    // the debounce window: a keepalive request outlives the page. If it fails, the
    // localStorage copy is restored on the next visit.
    function handlePageHide() {
      const current = draftRef.current
      if (!current || current.content === savedRef.current.content || inFlightRef.current) return
      clearTimers()
      const csrf = document.cookie.match(/(?:^|; )csrf_token=([^;]*)/)?.[1]
      void fetch(`/api/v1/notes/${noteId}`, {
        method: 'PATCH',
        keepalive: true,
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...(csrf ? { 'x-csrf-token': decodeURIComponent(csrf) } : {}),
        },
        body: JSON.stringify({ version: versionRef.current, content: current.content }),
      }).catch(() => {})
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', handlePageHide)
    return () => {
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [clearTimers, isDirty, noteId])

  // Leaving the note (navigating to another one, closing the view): send what's pending
  // now instead of dropping the debounce timer.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimers()
      if (isDirty()) void saveNowRef.current()
    }
  }, [clearTimers, isDirty])

  const setContent = useCallback(
    (content: string) => {
      const current = draftRef.current
      if (!current || content === current.content) return
      setDraft({ ...current, content })
      writeStoredDraft(noteId, { content, baseVersion: versionRef.current })
      if (fatalRef.current || conflictRef.current) return
      setStatus(navigator.onLine ? 'saving' : 'offline')
      retriesRef.current = 0
      scheduleSave()
    },
    [noteId, scheduleSave, setDraft],
  )

  const setTitle = useCallback(
    (title: string) => {
      const current = draftRef.current
      if (!current) return
      setTitleError(null)
      setDraft({ ...current, title })
    },
    [setDraft],
  )

  /** Whether the title field holds an uncommitted rename. */
  const titleChanged = useCallback(() => {
    const current = draftRef.current
    return current !== null && current.title.trim() !== savedRef.current.title
  }, [])

  const commitTitle = useCallback(
    (updateLinks: boolean) => {
      const current = draftRef.current
      if (!current) return
      const title = current.title.trim()
      if (!title || title === savedRef.current.title) {
        setDraft({ ...current, title: savedRef.current.title })
        setTitleError(null)
        return
      }
      pendingTitleRef.current = { title, updateLinks }
      void saveNowRef.current()
    },
    [setDraft],
  )

  const keepMine = useCallback(() => {
    if (!conflict) return
    versionRef.current = conflict.version
    savedRef.current = { title: conflict.title, content: conflict.content }
    setConflict(null)
    void saveNowRef.current()
  }, [conflict, setConflict])

  const loadServer = useCallback(() => {
    if (!conflict) return
    versionRef.current = conflict.version
    savedRef.current = { title: conflict.title, content: conflict.content }
    pendingTitleRef.current = null
    setDraft({ title: conflict.title, content: conflict.content })
    clearStoredDraft(noteId)
    setConflict(null)
    setStatus('saved')
  }, [conflict, noteId, setConflict, setDraft])

  return {
    draft,
    status,
    conflict,
    titleError,
    fatalError,
    setContent,
    setTitle,
    titleChanged,
    commitTitle,
    keepMine,
    loadServer,
    cancelPendingSave: clearTimers,
  }
}

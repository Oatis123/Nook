import { useSyncExternalStore } from 'react'

/** A note is open either for editing or for reading — one at a time. The last mode
 * picked carries over to the next note opened (and survives a reload); per device, like
 * the theme, since one might read on a phone and write on a computer. */
export type NoteMode = 'edit' | 'view'

const STORAGE_KEY = 'nook-note-mode'

function readStored(): NoteMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'view' ? 'view' : 'edit'
  } catch {
    return 'edit' // localStorage unavailable
  }
}

let current: NoteMode = readStored()
const listeners = new Set<() => void>()

export function setNoteMode(mode: NoteMode): void {
  if (mode === current) return
  current = mode
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* localStorage unavailable — the mode still applies for this session */
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  // Another tab switched modes.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return
    current = readStored()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useNoteMode(): NoteMode {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'edit',
  )
}

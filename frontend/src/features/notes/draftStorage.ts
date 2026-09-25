/** Unsaved content, kept in localStorage until the server has it — survives a closed
 * tab, a crash, or a session that expired mid-edit. `baseVersion` is the server version
 * the edits started from, so a restore can tell whether the note changed meanwhile. */
export interface StoredDraft {
  content: string
  baseVersion: number
}

const DRAFT_KEY_PREFIX = 'nook:note-draft:'
const storageKey = (noteId: string) => `${DRAFT_KEY_PREFIX}${noteId}`

export function readStoredDraft(noteId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(noteId))
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<StoredDraft>
    if (typeof value.content === 'string' && typeof value.baseVersion === 'number') {
      return { content: value.content, baseVersion: value.baseVersion }
    }
  } catch {
    // Unavailable or corrupt storage just means no local backup.
  }
  return null
}

export function writeStoredDraft(noteId: string, draft: StoredDraft): void {
  try {
    localStorage.setItem(storageKey(noteId), JSON.stringify(draft))
  } catch {
    // Quota exceeded / storage disabled: autosave still works, only the backup is lost.
  }
}

export function clearStoredDraft(noteId: string): void {
  try {
    localStorage.removeItem(storageKey(noteId))
  } catch {
    // ignore
  }
}

/** Drops every note's draft backup — on logout, so nothing stays on a shared computer. */
export function clearStoredDrafts(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(DRAFT_KEY_PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}

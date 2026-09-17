import type { Folder, NoteSummary } from '@/lib/types'

export interface WikilinkIndex {
  resolve(target: string): { id: string; title: string } | 'ambiguous' | null
}

/** Mirrors the backend's resolution in note_links.py: match by title (folder-qualified
 * `folder/Title` checked against the note's immediate folder name), falling back to a
 * plain title match. Alias matching is intentionally skipped here — it only affects
 * live-preview link styling, not what gets persisted, and keeping this index cheap to
 * rebuild on every keystroke matters more than alias completeness. */
export function buildWikilinkIndex(notes: NoteSummary[], folders: Folder[]): WikilinkIndex {
  const folderNameById = new Map(folders.map((f) => [f.id, f.name]))

  return {
    resolve(target: string) {
      let folderName: string | null = null
      let title = target
      const slash = target.lastIndexOf('/')
      if (slash !== -1) {
        folderName = target.slice(0, slash)
        title = target.slice(slash + 1)
      }

      const matches = notes.filter((n) => {
        if (n.title !== title) return false
        if (folderName === null) return true
        return n.folder_id !== null && folderNameById.get(n.folder_id) === folderName
      })

      if (matches.length === 1) return { id: matches[0].id, title: matches[0].title }
      if (matches.length > 1) return 'ambiguous'
      return null
    },
  }
}

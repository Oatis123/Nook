import type { Folder, NoteSummary } from '@/lib/types'

export interface FolderNode {
  folder: Folder
  children: FolderNode[]
  notes: NoteSummary[]
}

export interface Tree {
  roots: FolderNode[]
  rootNotes: NoteSummary[]
}

export function buildTree(folders: Folder[], notes: NoteSummary[]): Tree {
  const notesByFolder = new Map<string | null, NoteSummary[]>()
  for (const note of notes) {
    const key = note.folder_id
    const list = notesByFolder.get(key) ?? []
    list.push(note)
    notesByFolder.set(key, list)
  }

  const childrenByParent = new Map<string | null, Folder[]>()
  for (const folder of folders) {
    const list = childrenByParent.get(folder.parent_id) ?? []
    list.push(folder)
    childrenByParent.set(folder.parent_id, list)
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  }

  function build(parentId: string | null): FolderNode[] {
    return (childrenByParent.get(parentId) ?? []).map((folder) => ({
      folder,
      children: build(folder.id),
      notes: (notesByFolder.get(folder.id) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
    }))
  }

  return {
    roots: build(null),
    rootNotes: (notesByFolder.get(null) ?? []).sort((a, b) => a.title.localeCompare(b.title)),
  }
}

/** Finds a title that doesn't collide with an existing note in the same folder (spec
 * §6.1: titles are unique per folder) — "Untitled", then "Untitled 2", "Untitled 3", ...
 * Used before creating a note with a fixed default title, since silently failing on a
 * 409 would otherwise leave the "new note" button doing nothing the user can see. */
export function uniqueNoteTitle(
  base: string,
  notes: NoteSummary[],
  folderId: string | null,
): string {
  const titlesInFolder = new Set(notes.filter((n) => n.folder_id === folderId).map((n) => n.title))
  if (!titlesInFolder.has(base)) return base
  let i = 2
  while (titlesInFolder.has(`${base} ${i}`)) i++
  return `${base} ${i}`
}

export function collectDescendantFolderIds(node: FolderNode): Set<string> {
  const ids = new Set<string>([node.folder.id])
  for (const child of node.children) {
    for (const id of collectDescendantFolderIds(child)) ids.add(id)
  }
  return ids
}

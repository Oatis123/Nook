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

export function collectDescendantFolderIds(node: FolderNode): Set<string> {
  const ids = new Set<string>([node.folder.id])
  for (const child of node.children) {
    for (const id of collectDescendantFolderIds(child)) ids.add(id)
  }
  return ids
}

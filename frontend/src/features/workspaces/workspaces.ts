import { buildTree, collectDescendantFolderIds } from '@/features/notes/tree'
import type { Folder } from '@/lib/types'

export function workspaceByFolder(folders: Folder[] = []) {
  const result = new Map<string, Folder>()
  for (const root of buildTree(folders, []).roots) {
    for (const id of collectDescendantFolderIds(root)) result.set(id, root.folder)
  }
  return result
}

export function workspacePath(id: string, tab?: 'notes' | 'tasks') {
  return '/workspaces/' + id + (tab ? '/' + tab : '')
}

const inks = ['--ink-bi', '--ink-fn', '--ink-type', '--ink-prop', '--ink-kw']

export function workspaceInk(id: string) {
  const index = Array.from(id).reduce((sum, character) => sum + character.charCodeAt(0), 0)
  return `var(${inks[index % inks.length]})`
}

function recentKey(userId: string, workspaceId?: string) {
  return ['nook', 'recent-note', userId, workspaceId].filter(Boolean).join(':')
}

export function lastNote(userId?: string, workspaceId?: string) {
  if (!userId) return null
  try {
    return localStorage.getItem(recentKey(userId, workspaceId))
  } catch {
    return null
  }
}

export function rememberNote(userId: string, noteId: string, workspaceId?: string) {
  try {
    localStorage.setItem(recentKey(userId), noteId)
    if (workspaceId) localStorage.setItem(recentKey(userId, workspaceId), noteId)
  } catch {
    // Browsers can block storage. Project navigation still works via the overview.
  }
}

export function clearRememberedNotes(userId: string) {
  try {
    const key = recentKey(userId)
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const storedKey = localStorage.key(index)
      if (storedKey && (storedKey === key || storedKey.startsWith(key + ':'))) {
        localStorage.removeItem(storedKey)
      }
    }
  } catch {
    // Storage may be disabled.
  }
}

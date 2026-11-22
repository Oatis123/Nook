import type { Attachment, Folder } from '@/lib/types'

export type AttachmentTarget = Pick<Attachment, 'id' | 'filename' | 'mime' | 'folder_id'>
export type FolderPathNode = Pick<Folder, 'id' | 'name' | 'parent_id'>

export interface AttachmentIndex {
  resolve(target: string, noteFolderId?: string | null): { id: string; mime: string } | null
}

const SKIP_PREFIX_RE = /^(?:https?:|data:|mailto:|\/api\/)/i

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function resolveSegments(base: string[], relative: string[]): string[] | null {
  const stack = [...base]
  for (const segment of relative) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return null
      stack.pop()
    } else {
      stack.push(segment)
    }
  }
  return stack
}

function folderPathSegments(
  folderId: string,
  folderById: Map<string, FolderPathNode>,
): string[] | null {
  const segments: string[] = []
  const visited = new Set<string>()
  let current: string | null = folderId
  while (current !== null) {
    if (visited.has(current)) return null
    visited.add(current)
    const folder = folderById.get(current)
    if (!folder) return null
    segments.push(folder.name)
    current = folder.parent_id
  }
  segments.reverse()
  return segments
}

/** Resolves attachment references (`![[...]]` and `![alt](...)`) against the user's
 * attachments and folder tree, matching relative paths (`../images/foo.gif`, `./foo.gif`),
 * vault-root paths (`Course/images/foo.gif`), unambiguous folder suffixes, and bare
 * filenames (preferring the note's own folder, then a unique match across the vault). */
export function buildAttachmentIndex(
  attachments: AttachmentTarget[],
  folders: FolderPathNode[] = [],
): AttachmentIndex {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const folderSegmentsById = new Map<string, string[]>()
  const folderIdsByPath = new Map<string, string[]>()

  for (const folder of folders) {
    const segments = folderPathSegments(folder.id, folderById)
    if (!segments) continue
    folderSegmentsById.set(folder.id, segments)
    const path = segments.join('/')
    const ids = folderIdsByPath.get(path) ?? []
    ids.push(folder.id)
    folderIdsByPath.set(path, ids)
  }

  const byFilename = new Map<string, AttachmentTarget[]>()
  const byFolderAndFilename = new Map<string, Map<string, AttachmentTarget[]>>()

  for (const attachment of attachments) {
    const globalList = byFilename.get(attachment.filename) ?? []
    globalList.push(attachment)
    byFilename.set(attachment.filename, globalList)

    const folderKey = attachment.folder_id ?? ''
    let folderMap = byFolderAndFilename.get(folderKey)
    if (!folderMap) {
      folderMap = new Map<string, AttachmentTarget[]>()
      byFolderAndFilename.set(folderKey, folderMap)
    }
    const localList = folderMap.get(attachment.filename) ?? []
    localList.push(attachment)
    folderMap.set(attachment.filename, localList)
  }

  function findExact(
    folderId: string | null,
    filename: string,
  ): { id: string; mime: string } | null {
    const matches = byFolderAndFilename.get(folderId ?? '')?.get(filename)
    if (matches?.length === 1) return { id: matches[0].id, mime: matches[0].mime }
    return null
  }

  function findFolderId(segments: string[]): string | null | undefined {
    if (segments.length === 0) return null
    const ids = folderIdsByPath.get(segments.join('/'))
    if (ids?.length === 1) return ids[0]
    return undefined
  }

  function findBySuffix(
    dirSegments: string[],
    filename: string,
  ): { id: string; mime: string } | null {
    const suffix = dirSegments.filter((s) => s !== '' && s !== '.' && s !== '..')
    if (suffix.length === 0) return null

    const matches: AttachmentTarget[] = []
    for (const [folderId, segments] of folderSegmentsById.entries()) {
      if (segments.length < suffix.length) continue
      const offset = segments.length - suffix.length
      let matched = true
      for (let i = 0; i < suffix.length; i++) {
        if (segments[offset + i] !== suffix[i]) {
          matched = false
          break
        }
      }
      if (!matched) continue
      const inFolder = byFolderAndFilename.get(folderId)?.get(filename)
      if (inFolder) matches.push(...inFolder)
    }

    if (matches.length === 1) return { id: matches[0].id, mime: matches[0].mime }
    return null
  }

  return {
    resolve(target: string, noteFolderId?: string | null) {
      const trimmed = target.trim()
      if (!trimmed || SKIP_PREFIX_RE.test(trimmed)) return null

      const withoutFragment = trimmed.split(/[?#]/, 1)[0].replace(/\\/g, '/')
      if (!withoutFragment || withoutFragment.endsWith('/')) return null

      const decodedParts = withoutFragment.split('/').map(safeDecode)
      const filename = decodedParts[decodedParts.length - 1]
      if (!filename) return null

      const dirParts = decodedParts.slice(0, -1)
      const hasPath = dirParts.length > 0
      const isRootRelative = decodedParts[0] === ''

      if (hasPath) {
        if (!isRootRelative && noteFolderId !== undefined) {
          const baseSegments = noteFolderId ? (folderSegmentsById.get(noteFolderId) ?? null) : []
          if (baseSegments !== null) {
            const resolvedDir = resolveSegments(baseSegments, dirParts)
            if (resolvedDir !== null) {
              const folderId = findFolderId(resolvedDir)
              if (folderId !== undefined) {
                const match = findExact(folderId, filename)
                if (match) return match
              }
            }
          }
        }

        const rootDir = resolveSegments([], dirParts)
        if (rootDir !== null) {
          const folderId = findFolderId(rootDir)
          if (folderId !== undefined) {
            const match = findExact(folderId, filename)
            if (match) return match
          }
        }

        const suffixMatch = findBySuffix(dirParts, filename)
        if (suffixMatch) return suffixMatch

        const globalMatches = byFilename.get(filename)
        if (globalMatches?.length === 1) {
          return { id: globalMatches[0].id, mime: globalMatches[0].mime }
        }
        return null
      }

      if (noteFolderId !== undefined) {
        const localMatch = findExact(noteFolderId, filename)
        if (localMatch) return localMatch
      }

      const globalMatches = byFilename.get(filename)
      if (globalMatches?.length === 1) {
        return { id: globalMatches[0].id, mime: globalMatches[0].mime }
      }
      return null
    },
  }
}

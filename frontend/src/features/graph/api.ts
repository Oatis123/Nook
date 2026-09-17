import { apiFetch } from '@/lib/api'
import type { GraphData } from '@/lib/types'

export interface GraphParams {
  noteId?: string
  depth?: number
  folderId?: string
  tag?: string
  hideOrphans?: boolean
  showDangling?: boolean
}

export function getGraph(params: GraphParams = {}) {
  const search = new URLSearchParams()
  if (params.noteId) search.set('note_id', params.noteId)
  if (params.depth) search.set('depth', String(params.depth))
  if (params.folderId) search.set('folder_id', params.folderId)
  if (params.tag) search.set('tag', params.tag)
  if (params.hideOrphans) search.set('hide_orphans', 'true')
  if (params.showDangling === false) search.set('show_dangling', 'false')
  const qs = search.toString()
  return apiFetch<GraphData>(`/graph${qs ? `?${qs}` : ''}`)
}

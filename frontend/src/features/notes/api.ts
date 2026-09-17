import { apiFetch } from '@/lib/api'
import type { Folder, NoteDetail, NoteSummary } from '@/lib/types'

export const listFolders = () => apiFetch<Folder[]>('/folders')

export const createFolder = (input: { name: string; parent_id?: string | null }) =>
  apiFetch<Folder>('/folders', { method: 'POST', body: input })

export const updateFolder = (
  id: string,
  input: { name?: string; parent_id?: string | null; position?: number; move_to_root?: boolean },
) => apiFetch<Folder>(`/folders/${id}`, { method: 'PATCH', body: input })

export const deleteFolder = (id: string) => apiFetch<void>(`/folders/${id}`, { method: 'DELETE' })

export const listNotes = (
  params: { folderId?: string; root?: boolean; deleted?: boolean } = {},
) => {
  const search = new URLSearchParams()
  if (params.folderId) search.set('folder_id', params.folderId)
  if (params.root) search.set('root', 'true')
  if (params.deleted) search.set('deleted', 'true')
  const qs = search.toString()
  return apiFetch<NoteSummary[]>(`/notes${qs ? `?${qs}` : ''}`)
}

export const createNote = (input: { title: string; folder_id?: string | null; content?: string }) =>
  apiFetch<NoteDetail>('/notes', { method: 'POST', body: input })

export const getNote = (id: string) => apiFetch<NoteDetail>(`/notes/${id}`)

export const updateNote = (
  id: string,
  input: {
    version: number
    title?: string
    content?: string
    folder_id?: string | null
    move_to_root?: boolean
  },
) => apiFetch<NoteDetail>(`/notes/${id}`, { method: 'PATCH', body: input })

export const deleteNote = (id: string) => apiFetch<void>(`/notes/${id}`, { method: 'DELETE' })

export const restoreNote = (id: string) =>
  apiFetch<NoteDetail>(`/notes/${id}/restore`, { method: 'POST' })

export const permanentlyDeleteNote = (id: string) =>
  apiFetch<void>(`/notes/${id}/permanent`, { method: 'DELETE' })

export const emptyTrash = () =>
  apiFetch<{ deleted: number }>('/notes/trash/empty', { method: 'POST' })

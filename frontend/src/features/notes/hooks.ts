import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as notesApi from '@/features/notes/api'
import type { NoteSummary } from '@/lib/types'

export const foldersKey = ['folders'] as const
export const notesKey = (deleted = false) => ['notes', { deleted }] as const
export const noteKey = (id: string) => ['notes', id] as const

export function useFolders() {
  return useQuery({ queryKey: foldersKey, queryFn: notesApi.listFolders })
}

function useInvalidateFolders() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: foldersKey })
}

export function useCreateFolder() {
  const invalidate = useInvalidateFolders()
  return useMutation({ mutationFn: notesApi.createFolder, onSuccess: invalidate })
}

export function useUpdateFolder() {
  const invalidate = useInvalidateFolders()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof notesApi.updateFolder>[1]) =>
      notesApi.updateFolder(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteFolder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.deleteFolder,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: foldersKey })
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}

export function useNotes(params: { deleted?: boolean; tag?: string } = {}) {
  return useQuery({
    queryKey: params.tag
      ? (['notes', { tag: params.tag }] as const)
      : notesKey(params.deleted ?? false),
    queryFn: () => notesApi.listNotes({ deleted: params.deleted, tag: params.tag }),
  })
}

export type NoteLinkTarget = Pick<NoteSummary, 'id' | 'title' | 'folder_id'>

/** The note list reduced to what [[wikilinks]] resolve and complete against. Every autosave
 * refetches the list (the saved note's updated_at changes), which used to rebuild the
 * preview's markdown pipeline and reconfigure the editor each time; this keeps the same
 * array until an id, title or folder actually changes. */
export function useNoteLinkTargets(): NoteLinkTarget[] {
  const { data } = useNotes()
  const signature = useMemo(
    () => JSON.stringify((data ?? []).map((n) => [n.id, n.title, n.folder_id])),
    [data],
  )
  return useMemo(
    () =>
      (JSON.parse(signature) as [string, string, string | null][]).map(
        ([id, title, folder_id]) => ({ id, title, folder_id }),
      ),
    [signature],
  )
}

export function useTags() {
  return useQuery({ queryKey: ['tags'], queryFn: notesApi.listTags })
}

export function useBacklinks(noteId: string) {
  return useQuery({
    queryKey: ['notes', noteId, 'backlinks'],
    queryFn: () => notesApi.getBacklinks(noteId),
  })
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: noteKey(id ?? ''),
    queryFn: () => notesApi.getNote(id as string),
    enabled: id !== undefined,
    retry: false,
  })
}

/** Warms what opening a note needs — its data and the lazily loaded editor route — so a
 * click on a hovered or focused note renders at once. A fresh cached copy (the client's
 * staleTime) isn't fetched again, so repeated hovers cost nothing. */
export function usePrefetchNote() {
  const queryClient = useQueryClient()
  return (id: string) => {
    void import('@/features/notes/NoteEditorRoute')
    void queryClient.prefetchQuery({
      queryKey: noteKey(id),
      queryFn: () => notesApi.getNote(id),
      retry: false,
    })
  }
}

function useInvalidateNotesAndTags() {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: ['notes'] })
    queryClient.invalidateQueries({ queryKey: ['tags'] })
  }
}

export function useCreateNote() {
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({ mutationFn: notesApi.createNote, onSuccess: invalidate })
}

export function useUpdateNote(id: string) {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({
    mutationFn: (input: Parameters<typeof notesApi.updateNote>[1]) =>
      notesApi.updateNote(id, input),
    onSuccess: (note) => {
      queryClient.setQueryData(noteKey(id), note)
      invalidate()
    },
  })
}

export function useDeleteNote() {
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({ mutationFn: notesApi.deleteNote, onSuccess: invalidate })
}

export function useRestoreNote() {
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({ mutationFn: notesApi.restoreNote, onSuccess: invalidate })
}

export function usePermanentlyDeleteNote() {
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({ mutationFn: notesApi.permanentlyDeleteNote, onSuccess: invalidate })
}

export function useEmptyTrash() {
  const invalidate = useInvalidateNotesAndTags()
  return useMutation({ mutationFn: notesApi.emptyTrash, onSuccess: invalidate })
}

export function useUploadVaultImport() {
  return useMutation({ meta: { silent: true }, mutationFn: notesApi.uploadVaultImport })
}

export function useImportJob(jobId: string | null) {
  return useQuery({
    queryKey: ['import-jobs', jobId] as const,
    queryFn: () => notesApi.getImportJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 1000 : false
    },
  })
}

export function useCreateTaskFromNote(noteId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (title: string) => notesApi.createTaskFromNote(noteId, title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKey(noteId) })
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

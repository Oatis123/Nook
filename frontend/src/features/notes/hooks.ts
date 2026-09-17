import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as notesApi from '@/features/notes/api'

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

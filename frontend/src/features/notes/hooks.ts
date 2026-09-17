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

export function useNotes(params: { deleted?: boolean } = {}) {
  return useQuery({
    queryKey: notesKey(params.deleted ?? false),
    queryFn: () => notesApi.listNotes({ deleted: params.deleted }),
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

export function useCreateNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.createNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function useUpdateNote(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: Parameters<typeof notesApi.updateNote>[1]) =>
      notesApi.updateNote(id, input),
    onSuccess: (note) => {
      queryClient.setQueryData(noteKey(id), note)
      queryClient.invalidateQueries({ queryKey: ['notes'] })
    },
  })
}

export function useDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.deleteNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function useRestoreNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.restoreNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function usePermanentlyDeleteNote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.permanentlyDeleteNote,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  })
}

export function useEmptyTrash() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: notesApi.emptyTrash,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notes'] }),
  })
}

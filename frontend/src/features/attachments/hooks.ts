import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as attachmentsApi from '@/features/attachments/api'

export const attachmentsKey = ['attachments'] as const

export function useAttachments() {
  return useQuery({ queryKey: attachmentsKey, queryFn: attachmentsApi.listAttachments })
}

function useInvalidateAttachments() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: attachmentsKey })
}

export type UploadAttachmentInput = File | { file: File; folderId?: string | null }

export function useUploadAttachment() {
  const invalidate = useInvalidateAttachments()
  return useMutation({
    mutationFn: (input: UploadAttachmentInput) =>
      input instanceof File
        ? attachmentsApi.uploadAttachment(input)
        : attachmentsApi.uploadAttachment(input.file, input.folderId),
    onSuccess: invalidate,
  })
}

export function useUpdateAttachment() {
  const invalidate = useInvalidateAttachments()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: { id: string } & Parameters<typeof attachmentsApi.updateAttachment>[1]) =>
      attachmentsApi.updateAttachment(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteAttachment() {
  const invalidate = useInvalidateAttachments()
  return useMutation({ mutationFn: attachmentsApi.deleteAttachment, onSuccess: invalidate })
}

export function useCleanupUnusedAttachments() {
  const invalidate = useInvalidateAttachments()
  return useMutation({
    mutationFn: attachmentsApi.cleanupUnusedAttachments,
    onSuccess: invalidate,
  })
}

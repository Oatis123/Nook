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

export function useUploadAttachment() {
  const invalidate = useInvalidateAttachments()
  return useMutation({ mutationFn: attachmentsApi.uploadAttachment, onSuccess: invalidate })
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

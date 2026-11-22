import { apiFetch, uploadFile } from '@/lib/api'
import type { Attachment } from '@/lib/types'

export const listAttachments = () => apiFetch<Attachment[]>('/attachments')

export const uploadAttachment = (file: File, folderId?: string | null) => {
  const qs = folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''
  return uploadFile<Attachment>(`/attachments${qs}`, file)
}

export const updateAttachment = (
  id: string,
  input: { folder_id?: string | null; filename?: string },
) => apiFetch<Attachment>(`/attachments/${id}`, { method: 'PATCH', body: input })

export const deleteAttachment = (id: string) =>
  apiFetch<void>(`/attachments/${id}`, { method: 'DELETE' })

export const cleanupUnusedAttachments = () =>
  apiFetch<{ deleted: number }>('/attachments/cleanup', { method: 'POST' })

export const attachmentDownloadUrl = (id: string) => `/api/v1/attachments/${id}/download`

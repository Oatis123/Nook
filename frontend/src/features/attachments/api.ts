import { apiFetch, uploadFile } from '@/lib/api'
import type { Attachment } from '@/lib/types'

export const listAttachments = () => apiFetch<Attachment[]>('/attachments')

export const uploadAttachment = (file: File) => uploadFile<Attachment>('/attachments', file)

export const deleteAttachment = (id: string) =>
  apiFetch<void>(`/attachments/${id}`, { method: 'DELETE' })

export const cleanupUnusedAttachments = () =>
  apiFetch<{ deleted: number }>('/attachments/cleanup', { method: 'POST' })

export const attachmentDownloadUrl = (id: string) => `/api/v1/attachments/${id}/download`

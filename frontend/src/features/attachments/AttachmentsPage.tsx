import { type ChangeEvent, useRef } from 'react'
import { Paperclip, Upload } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { Button } from '@/design/components/Button'
import { formatDateTime, formatFileSize } from '@/lib/format'
import { attachmentDownloadUrl } from '@/features/attachments/api'
import {
  useAttachments,
  useCleanupUnusedAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from '@/features/attachments/hooks'
import { QueryState } from '@/design/components/QueryState'

export default function AttachmentsPage() {
  const attachments = useAttachments()
  const upload = useUploadAttachment()
  const deleteAttachment = useDeleteAttachment()
  const cleanup = useCleanupUnusedAttachments()
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload.mutate(file)
    e.target.value = ''
  }

  if (!attachments.data) return <QueryState query={attachments} />

  const unusedCount = attachments.data.filter((a) => a.used_by.length === 0).length

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-text">Attachments</h1>
        <div className="flex items-center gap-3">
          {unusedCount > 0 && (
            <button
              type="button"
              onClick={() => cleanup.mutate()}
              className="text-sm text-text-muted hover:text-danger"
            >
              Delete {unusedCount} unused
            </button>
          )}
          <Button size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload size={14} strokeWidth={1.5} />
            Upload
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload attachment"
          />
        </div>
      </div>

      {attachments.data.length === 0 ? (
        <EmptyState icon={Paperclip} title="No attachments yet" />
      ) : (
        <ul className="flex flex-col gap-2">
          {attachments.data.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <a
                href={attachmentDownloadUrl(attachment.id)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1"
              >
                <div className="truncate text-text hover:underline">{attachment.filename}</div>
                <div className="truncate text-xs text-text-muted">
                  {formatFileSize(attachment.size)} · {attachment.mime} ·{' '}
                  {formatDateTime(attachment.created_at)}
                  {attachment.used_by.length > 0 && <> · used in {attachment.used_by.join(', ')}</>}
                </div>
              </a>
              <button
                type="button"
                onClick={() => {
                  const usedNote =
                    attachment.used_by.length > 0
                      ? ` It's used in ${attachment.used_by.join(', ')}.`
                      : ''
                  if (confirm(`Delete "${attachment.filename}"?${usedNote}`)) {
                    deleteAttachment.mutate(attachment.id)
                  }
                }}
                className="shrink-0 text-text-muted hover:text-danger"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

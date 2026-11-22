import { type ChangeEvent, type DragEvent, type FormEvent, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import {
  File as FileIcon,
  Folder as FolderIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
  Upload,
} from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { DropdownMenu, type DropdownMenuItem } from '@/design/components/DropdownMenu'
import { IconButton } from '@/design/components/IconButton'
import { QueryState } from '@/design/components/QueryState'
import { SelectMenu } from '@/design/components/SelectMenu'
import { formatDateTime, formatFileSize } from '@/lib/format'
import { attachmentDownloadUrl } from '@/features/attachments/api'
import {
  useAttachments,
  useCleanupUnusedAttachments,
  useDeleteAttachment,
  useUpdateAttachment,
  useUploadAttachment,
} from '@/features/attachments/hooks'
import { useFolders } from '@/features/notes/hooks'
import { confirmAction } from '@/lib/confirm'
import { toast } from '@/lib/toast'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { Attachment, Folder } from '@/lib/types'

type FolderFilter = 'all' | 'root' | string
type DropTarget = 'list' | 'root' | string | null

function hasDraggedFiles(e: DragEvent): boolean {
  return (
    Array.from(e.dataTransfer?.types ?? []).includes('Files') ||
    (e.dataTransfer?.files?.length ?? 0) > 0
  )
}

interface FlatFolder {
  id: string
  name: string
  path: string
  depth: number
}

function buildFlatFolders(folders: Folder[]): FlatFolder[] {
  const childrenByParent = new Map<string | null, Folder[]>()
  for (const folder of folders) {
    const list = childrenByParent.get(folder.parent_id) ?? []
    list.push(folder)
    childrenByParent.set(folder.parent_id, list)
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
  }

  const flat: FlatFolder[] = []
  function walk(parentId: string | null, prefix: string, depth: number) {
    for (const folder of childrenByParent.get(parentId) ?? []) {
      const path = prefix ? `${prefix} / ${folder.name}` : folder.name
      flat.push({ id: folder.id, name: folder.name, path, depth })
      walk(folder.id, path, depth + 1)
    }
  }
  walk(null, '', 0)
  return flat
}

export default function AttachmentsPage() {
  useDocumentTitle('Attachments')
  const attachments = useAttachments()
  const foldersQuery = useFolders()
  const upload = useUploadAttachment()
  const updateAttachment = useUpdateAttachment()
  const deleteAttachment = useDeleteAttachment()
  const cleanup = useCleanupUnusedAttachments()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>('all')
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const [movingAttachment, setMovingAttachment] = useState<Attachment | null>(null)
  const [renamingAttachment, setRenamingAttachment] = useState<Attachment | null>(null)

  const flatFolders = useMemo(() => buildFlatFolders(foldersQuery.data ?? []), [foldersQuery.data])
  const folderPathById = useMemo(
    () => new Map(flatFolders.map((f) => [f.id, f.path])),
    [flatFolders],
  )

  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>()
    let rootCount = 0
    for (const item of attachments.data ?? []) {
      if (item.folder_id === null) rootCount += 1
      else counts.set(item.folder_id, (counts.get(item.folder_id) ?? 0) + 1)
    }
    return { counts, rootCount }
  }, [attachments.data])

  const activeFilter: FolderFilter =
    selectedFolder !== 'all' && selectedFolder !== 'root' && !folderPathById.has(selectedFolder)
      ? 'all'
      : selectedFolder

  const uploadTargetFolderId =
    activeFilter === 'all' || activeFilter === 'root' ? null : activeFilter

  const filteredAttachments = useMemo(() => {
    const list = attachments.data ?? []
    if (activeFilter === 'all') return list
    if (activeFilter === 'root') return list.filter((a) => a.folder_id === null)
    return list.filter((a) => a.folder_id === activeFilter)
  }, [attachments.data, activeFilter])

  async function uploadFilesToFolder(files: File[], folderId: string | null, notify = false) {
    if (files.length === 0) return
    const targetName = folderId ? (folderPathById.get(folderId) ?? 'folder') : 'Root'
    try {
      await Promise.all(files.map((file) => upload.mutateAsync({ file, folderId })))
      if (notify) {
        toast.success(
          files.length === 1
            ? `Uploaded "${files[0].name}" to "${targetName}"`
            : `Uploaded ${files.length} files to "${targetName}"`,
        )
      }
    } catch {
      // Global mutation error handler reports failed uploads.
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length > 0) void uploadFilesToFolder(files, uploadTargetFolderId)
    e.target.value = ''
  }

  function folderDropHandlers(target: DropTarget, folderId: string | null) {
    return {
      onDragOver: (e: DragEvent) => {
        if (!hasDraggedFiles(e)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setDropTarget(target)
      },
      onDragLeave: (e: DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDropTarget((current) => (current === target ? null : current))
        }
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDropTarget(null)
        const files = Array.from(e.dataTransfer?.files ?? [])
        void uploadFilesToFolder(files, folderId, true)
      },
    }
  }

  if (!attachments.data) return <QueryState query={attachments} />

  const unusedCount = attachments.data.filter((a) => a.used_by.length === 0).length
  const activeFolderLabel =
    activeFilter === 'all'
      ? 'All folders'
      : activeFilter === 'root'
        ? 'Root'
        : (folderPathById.get(activeFilter) ?? 'Folder')

  const mobileFilterOptions = [
    { value: 'all', label: `All folders (${attachments.data.length})` },
    { value: 'root', label: `Root (${countsByFolder.rootCount})` },
    ...flatFolders.map((f) => ({
      value: f.id,
      label: `${f.path} (${countsByFolder.counts.get(f.id) ?? 0})`,
    })),
  ]

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl text-text">Attachments</h1>
          <p className="mt-0.5 text-xs text-text-muted">
            {activeFilter === 'all'
              ? 'Showing all attachments · uploads go to Root'
              : `${activeFolderLabel} · uploads go here`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {unusedCount > 0 && (
            <button
              type="button"
              onClick={async () => {
                const ok = await confirmAction({
                  title: `Delete ${unusedCount} unused attachment${unusedCount === 1 ? '' : 's'}?`,
                  description:
                    'Files not embedded in any note are deleted permanently. This cannot be undone.',
                  confirmLabel: 'Delete',
                  danger: true,
                })
                if (ok) cleanup.mutate()
              }}
              className="text-sm text-text-muted hover:text-danger"
            >
              Delete {unusedCount} unused
            </button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={upload.isPending}
          >
            <Upload size={14} strokeWidth={1.5} />
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            aria-label="Upload attachment"
          />
        </div>
      </div>

      <div className="mb-4 md:hidden">
        <SelectMenu
          label="Folder filter"
          value={activeFilter}
          options={mobileFilterOptions}
          onChange={setSelectedFolder}
          style={{ width: '100%' }}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-[13.5rem_1fr]">
        <aside className="hidden md:block">
          <div className="rounded-(--oatis-radius-md) bg-surface p-2">
            <div className="mb-1 px-2 py-1 text-xs font-medium lowercase text-text-muted">
              Folders
            </div>
            <nav aria-label="Attachment folders" className="flex flex-col gap-0.5">
              <button
                type="button"
                data-active={activeFilter === 'all' || undefined}
                onClick={() => setSelectedFolder('all')}
                className="ui-nav-item flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm"
              >
                <span className="truncate">All files</span>
                <span className="shrink-0 text-xs text-text-muted">{attachments.data.length}</span>
              </button>
              <button
                type="button"
                data-active={activeFilter === 'root' || undefined}
                onClick={() => setSelectedFolder('root')}
                {...folderDropHandlers('root', null)}
                className={clsx(
                  'ui-nav-item flex items-center justify-between gap-2 px-2.5 py-1.5 text-left text-sm transition-colors',
                  dropTarget === 'root' && 'bg-surface-raised ring-1 ring-accent',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <FolderIcon size={14} strokeWidth={1.5} className="shrink-0" />
                  <span className="truncate">Root</span>
                </span>
                <span className="shrink-0 text-xs text-text-muted">{countsByFolder.rootCount}</span>
              </button>
              {flatFolders.map((folder) => {
                const count = countsByFolder.counts.get(folder.id) ?? 0
                return (
                  <button
                    key={folder.id}
                    type="button"
                    data-active={activeFilter === folder.id || undefined}
                    onClick={() => setSelectedFolder(folder.id)}
                    {...folderDropHandlers(folder.id, folder.id)}
                    title={folder.path}
                    className={clsx(
                      'ui-nav-item flex items-center justify-between gap-2 py-1.5 pr-2.5 text-left text-sm transition-colors',
                      dropTarget === folder.id && 'bg-surface-raised ring-1 ring-accent',
                    )}
                    style={{ paddingLeft: folder.depth * 12 + 10 }}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <FolderIcon size={14} strokeWidth={1.5} className="shrink-0" />
                      <span className="truncate">{folder.name}</span>
                    </span>
                    {count > 0 && <span className="shrink-0 text-xs text-text-muted">{count}</span>}
                  </button>
                )
              })}
            </nav>
          </div>
        </aside>

        <div
          aria-label="Attachments dropzone"
          {...folderDropHandlers('list', uploadTargetFolderId)}
          className={clsx(
            'min-h-48 min-w-0 rounded-(--oatis-radius-md) transition-colors',
            dropTarget === 'list' && 'bg-surface/70 p-2 ring-2 ring-accent',
          )}
        >
          {filteredAttachments.length === 0 ? (
            <EmptyState
              title={
                attachments.data.length === 0
                  ? 'No attachments yet'
                  : `No attachments in ${activeFolderLabel}`
              }
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {filteredAttachments.map((attachment) => {
                const folderLabel =
                  attachment.folder_id === null
                    ? 'Root'
                    : (folderPathById.get(attachment.folder_id) ?? 'Unknown folder')
                const isImage = attachment.mime.startsWith('image/')
                const menuItems: DropdownMenuItem[] = [
                  {
                    label: 'Move to…',
                    icon: FolderIcon,
                    onSelect: () => setMovingAttachment(attachment),
                  },
                  {
                    label: 'Rename',
                    icon: Pencil,
                    onSelect: () => setRenamingAttachment(attachment),
                  },
                  {
                    label: 'Delete',
                    icon: Trash2,
                    danger: true,
                    onSelect: async () => {
                      const usedNote =
                        attachment.used_by.length > 0
                          ? ` It's used in ${attachment.used_by.join(', ')} — those embeds will break.`
                          : ''
                      const ok = await confirmAction({
                        title: 'Delete attachment?',
                        description: `"${attachment.filename}" will be deleted permanently.${usedNote}`,
                        confirmLabel: 'Delete',
                        danger: true,
                      })
                      if (ok) deleteAttachment.mutate(attachment.id)
                    },
                  },
                ]

                return (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-3 rounded-(--oatis-radius-sm) border border-border bg-surface px-3 py-2.5 text-sm"
                  >
                    {isImage ? (
                      <a
                        href={attachmentDownloadUrl(attachment.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="h-11 w-11 shrink-0 overflow-hidden rounded-(--oatis-radius-sm) border border-border bg-surface-raised"
                      >
                        <img
                          src={attachmentDownloadUrl(attachment.id)}
                          alt={attachment.filename}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </a>
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-(--oatis-radius-sm) border border-border bg-surface-raised text-text-muted">
                        <FileIcon size={18} strokeWidth={1.5} />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <a
                        href={attachmentDownloadUrl(attachment.id)}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-medium text-text hover:underline"
                      >
                        {attachment.filename}
                      </a>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-muted">
                        <button
                          type="button"
                          onClick={() => setSelectedFolder(attachment.folder_id ?? 'root')}
                          className={clsx(
                            'inline-flex items-center gap-1 rounded-(--oatis-radius-sm) px-1.5 py-0.5 transition-colors',
                            'bg-surface-raised text-text-muted hover:text-text',
                          )}
                          title={`Filter by ${folderLabel}`}
                        >
                          <FolderIcon size={11} strokeWidth={1.5} />
                          <span className="max-w-48 truncate">{folderLabel}</span>
                        </button>
                        <span>
                          {formatFileSize(attachment.size)} · {attachment.mime} ·{' '}
                          {formatDateTime(attachment.created_at)}
                        </span>
                        {attachment.used_by.length > 0 && (
                          <span className="truncate">
                            · used in {attachment.used_by.join(', ')}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <DropdownMenu
                        items={menuItems}
                        trigger={
                          <IconButton label={`Actions for ${attachment.filename}`}>
                            <MoreHorizontal size={16} strokeWidth={1.5} />
                          </IconButton>
                        }
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      <MoveAttachmentDialog
        attachment={movingAttachment}
        folders={flatFolders}
        onClose={() => setMovingAttachment(null)}
        onMove={(attachment, folderId) => {
          updateAttachment.mutate({
            id: attachment.id,
            folder_id: folderId,
          })
          setMovingAttachment(null)
        }}
      />

      <RenameAttachmentDialog
        attachment={renamingAttachment}
        onClose={() => setRenamingAttachment(null)}
        onRename={(attachment, filename) => {
          updateAttachment.mutate({ id: attachment.id, filename })
          setRenamingAttachment(null)
        }}
      />
    </div>
  )
}

function MoveAttachmentDialog({
  attachment,
  folders,
  onClose,
  onMove,
}: {
  attachment: Attachment | null
  folders: FlatFolder[]
  onClose: () => void
  onMove: (attachment: Attachment, folderId: string | null) => void
}) {
  return (
    <Dialog
      open={attachment !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Move attachment"
      description={attachment ? `Choose a folder for "${attachment.filename}".` : undefined}
    >
      {attachment && (
        <MoveAttachmentForm
          key={attachment.id}
          attachment={attachment}
          folders={folders}
          onClose={onClose}
          onMove={onMove}
        />
      )}
    </Dialog>
  )
}

function MoveAttachmentForm({
  attachment,
  folders,
  onClose,
  onMove,
}: {
  attachment: Attachment
  folders: FlatFolder[]
  onClose: () => void
  onMove: (attachment: Attachment, folderId: string | null) => void
}) {
  const [target, setTarget] = useState(attachment.folder_id ?? '')

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        onMove(attachment, target || null)
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm text-text-muted">
        Destination
        <select
          data-autofocus
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-10 border border-border bg-surface-raised px-2 text-sm text-text outline-none focus-visible:border-accent"
        >
          <option value="">Root</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.path}
            </option>
          ))}
        </select>
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary">
          Move
        </Button>
      </div>
    </form>
  )
}

function RenameAttachmentDialog({
  attachment,
  onClose,
  onRename,
}: {
  attachment: Attachment | null
  onClose: () => void
  onRename: (attachment: Attachment, filename: string) => void
}) {
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!attachment) return
    const input = e.currentTarget.elements.namedItem('filename') as HTMLInputElement
    const next = input.value.trim()
    if (next && next !== attachment.filename) onRename(attachment, next)
    else onClose()
  }

  return (
    <Dialog
      open={attachment !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="Rename attachment"
    >
      {attachment && (
        <form key={attachment.id} className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1.5 text-sm text-text-muted">
            Filename
            <input
              name="filename"
              data-autofocus
              defaultValue={attachment.filename}
              className="h-10 border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  )
}

import { type DragEvent, type FormEvent, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import {
  ChevronRight,
  File,
  Folder as FolderIcon,
  FolderPlus,
  FilePlus,
  MoreHorizontal,
} from '@/design/icons'
import { DropdownMenu, type DropdownMenuItem } from '@/design/components/DropdownMenu'
import { IconButton } from '@/design/components/IconButton'
import { updateNote as updateNoteApi } from '@/features/notes/api'
import type { NoteSummary } from '@/lib/types'
import {
  buildTree,
  collectDescendantFolderIds,
  uniqueNoteTitle,
  type FolderNode,
} from '@/features/notes/tree'
import {
  useCreateFolder,
  useCreateNote,
  useDeleteFolder,
  useDeleteNote,
  useFolders,
  useNotes,
  useUpdateFolder,
  useUpdateNote,
} from '@/features/notes/hooks'

type DragPayload = { type: 'note' | 'folder'; id: string }
const DRAG_MIME = 'application/x-nook-item'

export function FolderTree() {
  const foldersQuery = useFolders()
  const notesQuery = useNotes()
  const navigate = useNavigate()
  const { noteId: activeNoteId } = useParams<{ noteId: string }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)

  const createFolder = useCreateFolder()
  const createNote = useCreateNote()
  const updateFolder = useUpdateFolder()
  const deleteNoteMutation = useDeleteNote()

  if (!foldersQuery.data || !notesQuery.data) return null

  const tree = buildTree(foldersQuery.data, notesQuery.data)

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function moveNoteToFolder(note: NoteSummary, folderId: string | null) {
    if (note.folder_id === folderId) return
    await updateNoteApi(note.id, {
      version: note.version,
      folder_id: folderId,
      move_to_root: folderId === null,
    })
    notesQuery.refetch()
  }

  function moveToFolder(payload: DragPayload, folderId: string | null) {
    if (payload.type === 'note') {
      const note = notesQuery.data?.find((n) => n.id === payload.id)
      if (note) moveNoteToFolder(note, folderId)
    } else {
      if (payload.id === folderId) return
      const node = findFolderNode(tree.roots, payload.id)
      if (node && folderId && collectDescendantFolderIds(node).has(folderId)) return
      updateFolder.mutate({
        id: payload.id,
        parent_id: folderId,
        move_to_root: folderId === null,
      })
    }
  }

  function handleDrop(e: DragEvent, folderId: string | null) {
    e.preventDefault()
    const raw = e.dataTransfer.getData(DRAG_MIME)
    if (!raw) return
    const payload = JSON.parse(raw) as DragPayload
    moveToFolder(payload, folderId)
  }

  return (
    <div
      className="flex flex-col gap-0.5 px-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => handleDrop(e, null)}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Notes</span>
        <div className="flex gap-0.5">
          <IconButton
            label="New folder"
            onClick={() => createFolder.mutate({ name: 'New folder', parent_id: null })}
          >
            <FolderPlus size={14} strokeWidth={1.5} />
          </IconButton>
          <IconButton
            label="New note"
            onClick={() =>
              createNote.mutate(
                {
                  title: uniqueNoteTitle('Untitled', notesQuery.data ?? [], null),
                  folder_id: null,
                },
                { onSuccess: (note) => navigate(`/notes/${note.id}`) },
              )
            }
          >
            <FilePlus size={14} strokeWidth={1.5} />
          </IconButton>
        </div>
      </div>

      {tree.roots.map((node) => (
        <FolderRow
          key={node.folder.id}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          renaming={renaming}
          setRenaming={setRenaming}
          activeNoteId={activeNoteId}
          onDropOn={handleDrop}
        />
      ))}

      {tree.rootNotes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          depth={0}
          active={note.id === activeNoteId}
          renaming={renaming === `note:${note.id}`}
          onStartRename={() => setRenaming(`note:${note.id}`)}
          onFinishRename={() => setRenaming(null)}
          onDelete={() => deleteNoteMutation.mutate(note.id)}
        />
      ))}

      {tree.roots.length === 0 && tree.rootNotes.length === 0 && (
        <p className="px-1 py-2 text-sm text-text-muted">No notes yet.</p>
      )}
    </div>
  )
}

function findFolderNode(nodes: FolderNode[], id: string): FolderNode | null {
  for (const node of nodes) {
    if (node.folder.id === id) return node
    const found = findFolderNode(node.children, id)
    if (found) return found
  }
  return null
}

function FolderRow({
  node,
  depth,
  expanded,
  onToggle,
  renaming,
  setRenaming,
  activeNoteId,
  onDropOn,
}: {
  node: FolderNode
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  renaming: string | null
  setRenaming: (id: string | null) => void
  activeNoteId: string | undefined
  onDropOn: (e: DragEvent, folderId: string | null) => void
}) {
  const navigate = useNavigate()
  const isOpen = expanded.has(node.folder.id)
  const isRenaming = renaming === `folder:${node.folder.id}`
  const createFolder = useCreateFolder()
  const createNote = useCreateNote()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolder()
  const deleteNoteMutation = useDeleteNote()
  const notesQuery = useNotes()
  const [dragOver, setDragOver] = useState(false)

  const items: DropdownMenuItem[] = [
    {
      label: 'New note',
      onSelect: () =>
        createNote.mutate(
          {
            title: uniqueNoteTitle('Untitled', notesQuery.data ?? [], node.folder.id),
            folder_id: node.folder.id,
          },
          { onSuccess: (note) => navigate(`/notes/${note.id}`) },
        ),
    },
    {
      label: 'New subfolder',
      onSelect: () => createFolder.mutate({ name: 'New folder', parent_id: node.folder.id }),
    },
    { label: 'Rename', onSelect: () => setRenaming(`folder:${node.folder.id}`) },
    {
      label: 'Delete',
      danger: true,
      onSelect: () => {
        if (confirm(`Delete "${node.folder.name}" and everything inside it?`)) {
          deleteFolder.mutate(node.folder.id)
        }
      },
    },
  ]

  function submitRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = e.currentTarget.elements.namedItem('name') as HTMLInputElement
    const name = input.value.trim()
    if (name) updateFolder.mutate({ id: node.folder.id, name })
    setRenaming(null)
  }

  return (
    <div>
      <div
        draggable
        onDragStart={(e) =>
          e.dataTransfer.setData(
            DRAG_MIME,
            JSON.stringify({ type: 'folder', id: node.folder.id } satisfies DragPayload),
          )
        }
        onDragOver={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.stopPropagation()
          setDragOver(false)
          onDropOn(e, node.folder.id)
        }}
        className={clsx(
          'ui-nav-item group flex items-center gap-1 rounded-md px-1 py-1 text-sm text-text hover:bg-surface-raised',
          dragOver && 'bg-surface-raised ring-1 ring-accent',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <button type="button" onClick={() => onToggle(node.folder.id)} className="shrink-0">
          <ChevronRight
            size={14}
            strokeWidth={1.5}
            className={clsx('text-text-muted transition-transform', isOpen && 'rotate-90')}
          />
        </button>
        <FolderIcon size={14} strokeWidth={1.5} className="shrink-0 text-text-muted" />
        {isRenaming ? (
          <form onSubmit={submitRename} className="flex-1">
            <input
              name="name"
              autoFocus
              defaultValue={node.folder.name}
              onBlur={() => setRenaming(null)}
              className="w-full rounded border border-accent bg-surface-raised px-1 text-sm outline-none"
            />
          </form>
        ) : (
          <button
            type="button"
            onClick={() => onToggle(node.folder.id)}
            className="flex-1 truncate text-left"
          >
            {node.folder.name}
          </button>
        )}
        <span className="opacity-0 group-hover:opacity-100">
          <DropdownMenu
            items={items}
            trigger={
              <IconButton label={`Actions for ${node.folder.name}`} className="h-6 w-6">
                <MoreHorizontal size={13} strokeWidth={1.5} />
              </IconButton>
            }
          />
        </span>
      </div>

      {isOpen && (
        <div>
          {node.children.map((child) => (
            <FolderRow
              key={child.folder.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              renaming={renaming}
              setRenaming={setRenaming}
              activeNoteId={activeNoteId}
              onDropOn={onDropOn}
            />
          ))}
          {node.notes.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              depth={depth + 1}
              active={note.id === activeNoteId}
              renaming={renaming === `note:${note.id}`}
              onStartRename={() => setRenaming(`note:${note.id}`)}
              onFinishRename={() => setRenaming(null)}
              onDelete={() => deleteNoteMutation.mutate(note.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function NoteRow({
  note,
  depth,
  active,
  renaming,
  onStartRename,
  onFinishRename,
  onDelete,
}: {
  note: NoteSummary
  depth: number
  active: boolean
  renaming: boolean
  onStartRename: () => void
  onFinishRename: () => void
  onDelete: () => void
}) {
  const navigate = useNavigate()
  const updateNote = useUpdateNote(note.id)

  const items: DropdownMenuItem[] = [
    { label: 'Rename', onSelect: onStartRename },
    { label: 'Delete', danger: true, onSelect: onDelete },
  ]

  function submitRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const input = e.currentTarget.elements.namedItem('title') as HTMLInputElement
    const title = input.value.trim()
    if (title) updateNote.mutate({ version: note.version, title })
    onFinishRename()
  }

  return (
    <div
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData(
          DRAG_MIME,
          JSON.stringify({ type: 'note', id: note.id } satisfies DragPayload),
        )
      }
      data-active={active || undefined}
      className={clsx(
        'ui-nav-item group flex items-center gap-1 rounded-md px-1 py-1 text-sm hover:bg-surface-raised',
        active ? 'bg-surface-raised text-text' : 'text-text-muted',
      )}
      style={{ paddingLeft: depth * 14 + 22 }}
    >
      <File size={14} strokeWidth={1.5} className="shrink-0" />
      {renaming ? (
        <form onSubmit={submitRename} className="flex-1">
          <input
            name="title"
            autoFocus
            defaultValue={note.title}
            onBlur={onFinishRename}
            className="w-full rounded border border-accent bg-surface-raised px-1 text-sm text-text outline-none"
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => navigate(`/notes/${note.id}`)}
          className="flex-1 truncate text-left"
        >
          {note.title}
        </button>
      )}
      <span className="opacity-0 group-hover:opacity-100">
        <DropdownMenu
          items={items}
          trigger={
            <IconButton label={`Actions for ${note.title}`} className="h-6 w-6">
              <MoreHorizontal size={13} strokeWidth={1.5} />
            </IconButton>
          }
        />
      </span>
    </div>
  )
}

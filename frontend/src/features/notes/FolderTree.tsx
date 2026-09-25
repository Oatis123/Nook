import { useQueryClient } from '@tanstack/react-query'
import { createContext, type DragEvent, type FormEvent, useContext, useState } from 'react'
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
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
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
import { QueryState } from '@/design/components/QueryState'
import { errorMessage } from '@/lib/errors'
import { toast } from '@/lib/toast'

type DragPayload = { type: 'note' | 'folder'; id: string }

/** Rows ask the tree to open the "Move to…" dialog — the touch- and keyboard-friendly
 * alternative to drag and drop (which phones don't support). */
const MoveContext = createContext<(payload: DragPayload) => void>(() => {})
const DRAG_MIME = 'application/x-nook-item'

export function FolderTree() {
  const foldersQuery = useFolders()
  const notesQuery = useNotes()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { noteId: activeNoteId } = useParams<{ noteId: string }>()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [moving, setMoving] = useState<DragPayload | null>(null)

  const createFolder = useCreateFolder()
  const createNote = useCreateNote()
  const updateFolder = useUpdateFolder()
  const deleteNoteMutation = useDeleteNote()

  if (!foldersQuery.data) return <QueryState query={foldersQuery} compact />
  if (!notesQuery.data) return <QueryState query={notesQuery} compact />

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
    try {
      await updateNoteApi(note.id, {
        version: note.version,
        folder_id: folderId,
        move_to_root: folderId === null,
      })
    } catch (error) {
      toast.error(errorMessage(error))
    }
    // The ['notes'] prefix also covers the moved note's own detail query, so an open
    // editor picks up the bumped version instead of hitting a false conflict on its
    // next save.
    queryClient.invalidateQueries({ queryKey: ['notes'] })
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
    <MoveContext.Provider value={setMoving}>
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
      <MoveDialog
        payload={moving}
        tree={tree}
        onClose={() => setMoving(null)}
        onMove={(payload, folderId) => {
          moveToFolder(payload, folderId)
          setMoving(null)
        }}
      />
    </MoveContext.Provider>
  )
}

function folderOptions(
  nodes: FolderNode[],
  exclude: string | null,
  prefix = '',
): { id: string; path: string }[] {
  return nodes.flatMap((node) => {
    if (node.folder.id === exclude) return [] // a folder can't move into itself or below
    const path = prefix ? `${prefix} / ${node.folder.name}` : node.folder.name
    return [{ id: node.folder.id, path }, ...folderOptions(node.children, exclude, path)]
  })
}

function MoveDialog({
  payload,
  tree,
  onClose,
  onMove,
}: {
  payload: DragPayload | null
  tree: ReturnType<typeof buildTree>
  onClose: () => void
  onMove: (payload: DragPayload, folderId: string | null) => void
}) {
  const [target, setTarget] = useState('')
  const options = folderOptions(tree.roots, payload?.type === 'folder' ? payload.id : null)

  return (
    <Dialog
      open={payload !== null}
      onOpenChange={(open) => {
        if (!open) {
          setTarget('')
          onClose()
        }
      }}
      title={payload?.type === 'folder' ? 'Move folder' : 'Move note'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (payload) onMove(payload, target || null)
          setTarget('')
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm text-text-muted">
          Destination
          <select
            autoFocus
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-10 rounded-md border border-border bg-surface-raised px-2 text-sm text-text outline-none focus-visible:border-accent"
          >
            <option value="">Top level</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.path}
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
    </Dialog>
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
  const startMove = useContext(MoveContext)
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
    { label: 'Move to…', onSelect: () => startMove({ type: 'folder', id: node.folder.id }) },
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
        <span className="reveal-on-hover">
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

  const startMove = useContext(MoveContext)

  const items: DropdownMenuItem[] = [
    { label: 'Rename', onSelect: onStartRename },
    { label: 'Move to…', onSelect: () => startMove({ type: 'note', id: note.id }) },
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
      <span className="reveal-on-hover">
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

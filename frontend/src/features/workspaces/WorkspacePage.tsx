import { useMemo, useState } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { EmptyState } from '@/design/components/EmptyState'
import { IconButton } from '@/design/components/IconButton'
import { QueryState } from '@/design/components/QueryState'
import { ChevronRight, FileText, Pencil, Plus, Star } from '@/design/icons'
import { useFolders, useNotes, usePrefetchNote, useUpdateFolder } from '@/features/notes/hooks'
import { WorkspaceEditDialog, WorkspaceNoteDialog } from '@/features/workspaces/WorkspaceDialogs'
import { WorkspaceTasks } from '@/features/workspaces/WorkspaceTasks'
import { workspaceByFolder, workspacePath } from '@/features/workspaces/workspaces'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import type { Folder, NoteSummary } from '@/lib/types'

export default function WorkspacePage() {
  const { workspaceId, tab } = useParams()
  const folders = useFolders()
  const notes = useNotes()
  const assignments = useMemo(() => workspaceByFolder(folders.data), [folders.data])
  const folder =
    workspaceId && folders.data?.find((item) => item.id === workspaceId && !item.parent_id)
  useDocumentTitle(folder ? folder.name : 'Workspace')
  if (!folders.data) return <QueryState query={folders} />
  if (!folder) {
    return (
      <EmptyState
        title="Workspace unavailable"
        action={
          <Link to="/notes" className="text-accent underline">
            Browse workspaces
          </Link>
        }
      />
    )
  }
  if (!notes.data && tab !== 'tasks') return <QueryState query={notes} />

  const projectNotes = (notes.data ?? [])
    .filter((note) => note.folder_id && assignments.get(note.folder_id)?.id === folder.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  return (
    <Workspace
      key={folder.id}
      folder={folder}
      folders={folders.data}
      notes={projectNotes}
      tab={tab}
      assignments={assignments}
    />
  )
}

function Workspace({
  folder,
  folders,
  notes,
  tab,
  assignments,
}: {
  folder: Folder
  folders: Folder[]
  notes: NoteSummary[]
  tab?: string
  assignments: Map<string, Folder>
}) {
  const [editing, setEditing] = useState(false)
  const [creating, setCreating] = useState(false)
  const update = useUpdateFolder()
  const pinned = notes.find((note) => note.id === folder.pinned_note_id)
  const overview = tab !== 'notes' && tab !== 'tasks'

  return (
    <section className="mx-auto max-w-5xl px-4 py-7 sm:px-9 sm:py-10">
      <div className="ui-rise flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link
            to="/notes"
            className="inline-flex items-center gap-2 text-xs text-text-muted hover:text-accent"
          >
            Workspaces <ChevronRight size={12} />
          </Link>
          <h1 className="mt-2 break-words text-4xl font-extrabold tracking-tight sm:text-5xl">
            {folder.name}
          </h1>
          {folder.description && (
            <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm text-text-muted">
              {folder.description}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <IconButton label="Edit workspace" onClick={() => setEditing(true)}>
            <Pencil size={16} />
          </IconButton>
          {tab !== 'tasks' && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} /> New note
            </Button>
          )}
        </div>
      </div>
      <nav aria-label="Workspace sections" className="ui-fluid-segments mt-6 [--segment-count:3]">
        {([undefined, 'notes', 'tasks'] as const).map((page) => (
          <NavLink
            end
            key={page ?? 'overview'}
            to={workspacePath(folder.id, page)}
            className="flex min-h-10 items-center justify-center px-3 text-sm font-semibold sm:px-5"
          >
            {page === 'notes' ? 'Notes' : page === 'tasks' ? 'Tasks' : 'Overview'}
          </NavLink>
        ))}
      </nav>

      {overview ? (
        <div key="overview" className="ui-rise mt-6 grid gap-7 lg:grid-cols-[1.2fr_1fr]">
          <section className="min-w-0">
            <SectionHeader
              title="Notes"
              action="All notes"
              to={workspacePath(folder.id, 'notes')}
            />
            {pinned && <NoteLink note={pinned} pinned />}
            {notes
              .filter((note) => note !== pinned)
              .slice(0, 4)
              .map((note) => (
                <NoteLink key={note.id} note={note} />
              ))}
            {notes.length === 0 && (
              <p className="px-2 py-6 text-sm text-text-muted">No notes yet</p>
            )}
          </section>
          <section className="min-w-0">
            <SectionHeader
              title="Next tasks"
              action="Workspace tasks"
              to={workspacePath(folder.id, 'tasks')}
            />
            <WorkspaceTasks folder={folder} assignments={assignments} overview />
          </section>
        </div>
      ) : tab === 'notes' ? (
        <div key="notes" className="ui-rise mt-5 grid gap-1">
          {notes.map((note) => (
            <div key={note.id} className="flex min-w-0 items-center gap-2">
              <div className="min-w-0 flex-1">
                <NoteLink
                  note={note}
                  detail={
                    note.folder_id === folder.id
                      ? undefined
                      : folders.find((item) => item.id === note.folder_id)?.name
                  }
                />
              </div>
              <IconButton
                label={note === pinned ? 'Unpin ' + note.title : 'Pin ' + note.title}
                active={note === pinned}
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({ id: folder.id, pinned_note_id: note === pinned ? null : note.id })
                }
              >
                <Star size={16} className={note === pinned ? 'fill-current' : undefined} />
              </IconButton>
            </div>
          ))}
          {notes.length === 0 && <EmptyState title="No notes yet" />}
        </div>
      ) : (
        <div key="tasks" className="ui-rise mt-5">
          <WorkspaceTasks folder={folder} assignments={assignments} />
        </div>
      )}
      {editing && <WorkspaceEditDialog folder={folder} close={() => setEditing(false)} />}
      {creating && <WorkspaceNoteDialog folder={folder} close={() => setCreating(false)} />}
    </section>
  )
}

function SectionHeader({ title, action, to }: { title: string; action: string; to: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <Link
        to={to}
        className="ui-nav-item inline-flex items-center gap-1 px-2 py-1 text-xs text-text-muted"
      >
        {action} <ChevronRight size={13} />
      </Link>
    </div>
  )
}

function NoteLink({
  note,
  pinned = false,
  detail,
}: {
  note: NoteSummary
  pinned?: boolean
  detail?: string
}) {
  const prefetch = usePrefetchNote()
  return (
    <Link
      to={'/notes/' + note.id}
      onMouseEnter={() => prefetch(note.id)}
      onFocus={() => prefetch(note.id)}
      className={
        pinned
          ? 'ui-tonal-link mb-2 grid gap-1 bg-surface px-4 py-3 hover:bg-surface-raised'
          : 'ui-nav-item flex min-w-0 items-center gap-2.5 px-3 py-2.5 text-sm'
      }
    >
      {pinned ? (
        <span className="flex items-center gap-1.5 text-xs text-accent">
          <Star size={14} /> Pinned
        </span>
      ) : (
        <FileText size={16} className="text-text-muted" />
      )}
      <span className={pinned ? 'break-words text-base font-bold' : 'min-w-0 flex-1 truncate'}>
        {note.title}
      </span>
      {detail && <span className="max-w-[35%] truncate text-xs text-text-muted">{detail}</span>}
    </Link>
  )
}

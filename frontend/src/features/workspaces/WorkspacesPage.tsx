import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { QueryState } from '@/design/components/QueryState'
import { ChevronRight, FileText, Folder, Inbox, Plus } from '@/design/icons'
import { useCurrentUser } from '@/features/auth/hooks'
import { useFolders, useNotes } from '@/features/notes/hooks'
import { useTaskLists } from '@/features/tasks/hooks'
import { WorkspaceEditDialog, WorkspaceNoteDialog } from '@/features/workspaces/WorkspaceDialogs'
import { workspacePath } from '@/features/workspaces/workspaces'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function WorkspacesPage() {
  const [params] = useSearchParams()
  const inbox = params.get('view') === 'inbox'
  const folders = useFolders()
  const notes = useNotes()
  const { data: lists } = useTaskLists()
  const { data: user } = useCurrentUser()
  const [creating, setCreating] = useState(false)
  useDocumentTitle(inbox ? 'Inbox' : 'Workspaces')
  const roots = folders.data?.filter((folder) => !folder.parent_id)
  const inboxList = lists?.find((list) => list.is_inbox)
  const rootNotes = notes.data?.filter((note) =>
    note.is_ideas ? !user?.ideas_note_hidden : !note.folder_id,
  )

  return (
    <section className="mx-auto max-w-5xl px-4 py-7 sm:px-9 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          {inbox ? 'Inbox' : 'Workspaces'}
        </h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={16} /> {inbox ? 'New note' : 'New workspace'}
        </Button>
      </div>
      {inbox ? (
        <div className="mt-6 grid gap-4">
          {rootNotes ? (
            <div className="grid gap-1">
              {rootNotes.map((note) => (
                <Link
                  key={note.id}
                  to={'/notes/' + note.id}
                  className="ui-nav-item flex items-center gap-2 bg-surface px-4 py-3 text-sm"
                >
                  <FileText size={16} className="text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{note.title}</span>
                </Link>
              ))}
              {rootNotes.length === 0 && (
                <p className="text-sm text-text-muted">No notes in Inbox</p>
              )}
            </div>
          ) : (
            <QueryState query={notes} />
          )}
          {inboxList && (
            <Link
              to={'/tasks/list/' + inboxList.id}
              className="ui-nav-item inline-flex w-fit items-center gap-2 px-3 py-2 text-sm text-accent"
            >
              Inbox tasks <ChevronRight size={14} />
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-7 grid gap-2">
          {roots ? (
            roots.map((folder) => (
              <Link
                key={folder.id}
                to={workspacePath(folder.id)}
                className="flex min-w-0 items-center gap-4 rounded-md bg-surface px-4 py-3.5 hover:bg-surface-raised"
              >
                <Folder size={20} className="text-text-muted" />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-bold">{folder.name}</h2>
                  {folder.description && (
                    <p className="truncate text-sm text-text-muted">{folder.description}</p>
                  )}
                </div>
                <ChevronRight size={16} className="text-text-muted" />
              </Link>
            ))
          ) : (
            <QueryState query={folders} />
          )}
          <Link
            to="/notes?view=inbox"
            className="ui-nav-item flex items-center gap-3 px-4 py-3 text-sm text-text-muted"
          >
            <Inbox size={18} /> Inbox <ChevronRight size={14} />
          </Link>
        </div>
      )}
      {creating &&
        (inbox ? (
          <WorkspaceNoteDialog close={() => setCreating(false)} />
        ) : (
          <WorkspaceEditDialog close={() => setCreating(false)} />
        ))}
    </section>
  )
}

import { Trash2 } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { formatDateTime } from '@/lib/format'
import {
  useEmptyTrash,
  useNotes,
  usePermanentlyDeleteNote,
  useRestoreNote,
} from '@/features/notes/hooks'
import { QueryState } from '@/design/components/QueryState'

export default function TrashPage() {
  const trashed = useNotes({ deleted: true })
  const restore = useRestoreNote()
  const permanentlyDelete = usePermanentlyDeleteNote()
  const emptyTrash = useEmptyTrash()

  if (!trashed.data) return <QueryState query={trashed} />

  if (trashed.data.length === 0) {
    return <EmptyState icon={Trash2} title="Trash is empty" />
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-serif text-2xl text-text">Trash</h1>
        <button
          type="button"
          onClick={() => {
            if (confirm('Permanently delete everything in the trash?')) emptyTrash.mutate()
          }}
          className="text-sm text-danger hover:underline"
        >
          Empty trash
        </button>
      </div>
      <p className="mb-4 text-sm text-text-muted">
        Notes are removed automatically 30 days after being trashed.
      </p>

      <ul className="flex flex-col gap-2">
        {trashed.data.map((note) => (
          <li
            key={note.id}
            className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <div className="min-w-0">
              <div className="truncate text-text">{note.title}</div>
              <div className="text-xs text-text-muted">
                Trashed {note.deleted_at ? formatDateTime(note.deleted_at) : ''}
              </div>
            </div>
            <div className="flex shrink-0 gap-3">
              <button
                type="button"
                onClick={() => restore.mutate(note.id)}
                className="text-text-muted hover:text-text"
              >
                Restore
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Permanently delete "${note.title}"?`)) {
                    permanentlyDelete.mutate(note.id)
                  }
                }}
                className="text-text-muted hover:text-danger"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

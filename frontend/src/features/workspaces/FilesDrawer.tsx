import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { Folder } from '@/design/icons'
import { FolderTree } from '@/features/notes/FolderTree'
import { TagList } from '@/features/notes/TagList'
import { useNotes } from '@/features/notes/hooks'

export function FilesDrawer({ workspaceId }: { workspaceId?: string }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const { data: notes } = useNotes()
  const close = useCallback(() => {
    setOpen(false)
    setFilter('')
  }, [])
  const keyword = filter.trim().toLocaleLowerCase()
  const results = keyword
    ? notes?.filter((note) => note.title.toLocaleLowerCase().includes(keyword))
    : undefined

  return (
    <Dialog
      trigger={
        <Button size="sm" variant="ghost" aria-label="Files">
          <Folder size={16} />
          <span className="hidden sm:inline">Files</span>
        </Button>
      }
      title="Files"
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      placement="right"
    >
      {open && (
        <>
          <input
            type="search"
            data-autofocus
            aria-label="Filter files"
            placeholder="Find a note"
            className="ui-field mb-3 h-10 shrink-0 border border-border bg-surface px-3 text-sm focus-visible:border-accent"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {results ? (
              <div className="grid gap-1" aria-live="polite">
                {results.map((note) => (
                  <Link
                    key={note.id}
                    to={'/notes/' + note.id}
                    onClick={close}
                    className="ui-nav-item break-words px-3 py-2 text-sm"
                  >
                    {note.title}
                  </Link>
                ))}
                {results.length === 0 && (
                  <p className="px-2 py-3 text-sm text-text-muted">No matches</p>
                )}
              </div>
            ) : (
              <>
                <FolderTree workspaceId={workspaceId} onNoteSelected={close} />
                <TagList />
              </>
            )}
          </div>
        </>
      )}
    </Dialog>
  )
}

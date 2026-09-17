import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Link2, Plus } from 'lucide-react'
import { EmptyState } from '@/design/components/EmptyState'
import { useBacklinks, useCreateTaskFromNote, useNote } from '@/features/notes/hooks'
import { useCompleteTask, useReopenTask } from '@/features/tasks/hooks'
import { useGraph } from '@/features/graph/hooks'
import { GraphCanvas } from '@/features/graph/GraphCanvas'
import type { LinkedTask } from '@/lib/types'

interface Heading {
  level: number
  text: string
}

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  for (const line of content.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) headings.push({ level: match[1].length, text: match[2].trim() })
  }
  return headings
}

function OutlineSection({ content }: { content: string }) {
  const headings = useMemo(() => extractHeadings(content), [content])

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Outline</h3>
      {headings.length === 0 ? (
        <p className="text-sm text-text-muted">No headings yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {headings.map((h, i) => (
            <li
              key={i}
              className="truncate text-sm text-text-muted"
              style={{ paddingLeft: (h.level - 1) * 10 }}
            >
              {h.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BacklinksSection({ noteId }: { noteId: string }) {
  const backlinks = useBacklinks(noteId)
  const navigate = useNavigate()

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        Backlinks
      </h3>
      {!backlinks.data || backlinks.data.length === 0 ? (
        <p className="text-sm text-text-muted">No notes link here yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {backlinks.data.map((link, i) => (
            <li key={`${link.source_note_id}-${i}`}>
              <button
                type="button"
                onClick={() => navigate(`/notes/${link.source_note_id}`)}
                className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-text hover:bg-surface-raised"
              >
                <Link2 size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="truncate">
                  {link.source_note_title}
                  {link.heading && <span className="text-text-muted"> #{link.heading}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LinkedTaskRow({ task }: { task: LinkedTask }) {
  const navigate = useNavigate()
  const completeTask = useCompleteTask()
  const reopenTask = useReopenTask()
  const done = task.status === 'done'

  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-raised">
      <button
        type="button"
        onClick={() => (done ? reopenTask.mutate(task.id) : completeTask.mutate({ id: task.id }))}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={clsx(
          'h-3.5 w-3.5 shrink-0 rounded-full border transition-colors duration-150',
          done ? 'border-accent bg-accent' : 'border-border hover:border-accent',
        )}
      />
      <button
        type="button"
        onClick={() => navigate(`/tasks/list/${task.list_id}`)}
        className={clsx(
          'flex-1 truncate text-left text-sm',
          done ? 'text-text-muted line-through' : 'text-text',
        )}
      >
        {task.title}
      </button>
    </div>
  )
}

function LinkedTasksSection({ noteId, tasks }: { noteId: string; tasks: LinkedTask[] }) {
  const createTaskFromNote = useCreateTaskFromNote(noteId)
  const [title, setTitle] = useState('')

  function submit() {
    const trimmed = title.trim()
    if (!trimmed) return
    createTaskFromNote.mutate(trimmed)
    setTitle('')
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        Linked tasks
      </h3>
      {tasks.length > 0 && (
        <div className="mb-1.5 flex flex-col gap-0.5">
          {tasks.map((task) => (
            <LinkedTaskRow key={task.id} task={task} />
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex items-center gap-1.5"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New task from this note…"
          className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-text outline-none placeholder:text-text-muted focus-visible:border-accent"
        />
        <button
          type="submit"
          aria-label="Create task"
          disabled={!title.trim()}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-text-muted hover:text-text disabled:opacity-50"
        >
          <Plus size={14} strokeWidth={1.5} />
        </button>
      </form>
    </div>
  )
}

function LocalGraphSection({ noteId }: { noteId: string }) {
  const [depth, setDepth] = useState<1 | 2>(1)
  const graphQuery = useGraph({ noteId, depth })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Local graph</h3>
        <div className="inline-flex rounded-md border border-border bg-bg p-0.5 text-xs">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              className={clsx(
                'rounded px-1.5 py-0.5 transition-colors duration-150',
                depth === d ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      {graphQuery.data && graphQuery.data.nodes.length > 1 ? (
        <GraphCanvas data={graphQuery.data} colorBy="folder" height={220} />
      ) : (
        <p className="text-sm text-text-muted">No connections yet.</p>
      )}
    </div>
  )
}

export function NoteContextPanel({ noteId }: { noteId: string }) {
  const note = useNote(noteId)

  if (!note.data) {
    return <EmptyState icon={Link2} title="Select a note" />
  }

  return (
    <div className="flex flex-col gap-6 px-3">
      <OutlineSection content={note.data.content} />
      <BacklinksSection noteId={noteId} />
      <LinkedTasksSection noteId={noteId} tasks={note.data.linked_tasks} />
      <LocalGraphSection noteId={noteId} />
    </div>
  )
}

import { useCallback, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { Calendar, ChevronRight, FileText, Plus } from '@/design/icons'
import { sceneFor, useDayPhase } from '@/features/notes/dayPhase'
import { useTaskLists, useTasks } from '@/features/tasks/hooks'
import { useToday } from '@/features/tasks/useToday'
import { AddTaskButton } from '@/features/tasks/AddTaskButton'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import type { Task } from '@/lib/types'
import { QueryState } from '@/design/components/QueryState'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useResolvedTheme } from '@/lib/theme'
import { useCurrentUser } from '@/features/auth/hooks'
import { useFolders, useNotes, useOpenDailyNote } from '@/features/notes/hooks'
import { WorkspaceNoteDialog } from '@/features/workspaces/WorkspaceDialogs'
import { lastNote, workspaceByFolder } from '@/features/workspaces/workspaces'

export default function TodayView() {
  const navigate = useNavigate()
  const openDaily = useOpenDailyNote()
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [quickNote, setQuickNote] = useState(false)
  // Stable, so the (memoized) task rows don't all re-render when a task opens.
  const openTask = useCallback((task: Task) => setOpenTaskId(task.id), [])
  const tasksQuery = useTasks({ view: 'today' })
  const { data: user } = useCurrentUser()
  const { data: notes } = useNotes()
  const { data: folders } = useFolders()
  const { data: lists } = useTaskLists()
  const assignments = useMemo(() => workspaceByFolder(folders), [folders])
  const today = useToday()
  const phase = useDayPhase()
  const theme = useResolvedTheme()
  const scene = sceneFor(phase, theme).wide
  useDocumentTitle('Today')

  const tasks = tasksQuery.data ?? []
  const overdue = tasks.filter((t) => t.due_date! < today)
  const dueToday = tasks.filter((t) => t.due_date! === today)
  const groups: TaskGroup[] = [
    ...(overdue.length > 0 ? [{ label: 'Overdue', tasks: overdue }] : []),
    ...(dueToday.length > 0 ? [{ label: 'Today', tasks: dueToday }] : []),
  ]
  const recentId = lastNote(user?.id)
  const recent = notes?.find((note) => note.id === recentId)
  const workspace = recent?.folder_id && assignments.get(recent.folder_id)
  const listNames = new Map(
    lists?.map((list) => [list.id, assignments.get(list.workspace_id ?? '')?.name ?? list.name]),
  )
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(today + 'T00:00:00Z'))

  return (
    <div className="mx-auto max-w-5xl px-4 py-7 sm:px-9 sm:py-10">
      <header className="ui-rise grid overflow-hidden rounded-lg bg-surface sm:grid-cols-[minmax(0,1fr)_34%]">
        <div className="flex min-w-0 flex-col justify-center gap-4 px-4 py-5 sm:px-6 sm:py-7">
          <div>
            <p className="text-sm text-text-muted">{formattedDate}</p>
            <h1 className="mt-1 text-4xl font-extrabold tracking-tight sm:text-5xl">Today</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={openDaily.isPending}
              onClick={() =>
                openDaily.mutate(undefined, {
                  onSuccess: (note) => navigate(`/notes/${note.id}`),
                })
              }
            >
              <Calendar size={16} /> Daily note
            </Button>
            <Button variant="secondary" onClick={() => setQuickNote(true)}>
              <Plus size={16} /> Quick note
            </Button>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="relative order-first min-h-20 overflow-hidden sm:order-none"
        >
          <img
            src={scene}
            alt=""
            className="absolute inset-0 h-full w-full object-cover object-center"
          />
        </div>
      </header>
      {recent && (
        <section className="mt-7">
          <h2 className="mb-2 text-lg font-bold tracking-tight">Continue working</h2>
          <Link
            to={'/notes/' + recent.id}
            className="ui-tonal-link flex items-center gap-3 bg-surface px-4 py-3 hover:bg-surface-raised"
          >
            <FileText size={18} className="text-accent" />
            <div className="min-w-0 flex-1">
              <span className="block truncate text-xs text-text-muted">
                {workspace ? workspace.name : 'Inbox'}
              </span>
              <span className="block truncate font-semibold">{recent.title}</span>
            </div>
            <ChevronRight size={16} className="text-text-muted" />
          </Link>
        </section>
      )}

      <section className="mt-7">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold tracking-tight">Tasks due today</h2>
          <Link
            to="/tasks/all"
            className="ui-nav-item flex items-center gap-1 px-2 py-1.5 text-sm text-text-muted"
          >
            All tasks <ChevronRight size={13} />
          </Link>
        </div>
        <div className="mb-3">
          <AddTaskButton variant="secondary" />
        </div>
        {!tasksQuery.data ? (
          <QueryState query={tasksQuery} compact />
        ) : tasks.length === 0 ? (
          <p className="px-3 py-5 font-(family-name:--font-prose) text-text-muted">
            Nothing due today
          </p>
        ) : (
          <TaskGroupedList
            groups={groups}
            onOpenTask={openTask}
            emptyMessage="Nothing due today"
            listNames={listNames}
          />
        )}
      </section>
      {quickNote && <WorkspaceNoteDialog close={() => setQuickNote(false)} />}
      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

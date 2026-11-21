import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { EmptyState } from '@/design/components/EmptyState'
import { QueryState } from '@/design/components/QueryState'
import { Calendar } from '@/design/icons'
import { sceneFor, useDayPhase } from '@/features/notes/dayPhase'
import { useOpenDailyNote } from '@/features/notes/hooks'
import { AddTaskButton } from '@/features/tasks/AddTaskButton'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import { useTasks } from '@/features/tasks/hooks'
import { useToday } from '@/features/tasks/useToday'
import { useResolvedTheme } from '@/lib/theme'
import type { Task } from '@/lib/types'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function TodayView() {
  const navigate = useNavigate()
  const openDaily = useOpenDailyNote()
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Stable, so the (memoized) task rows don't all re-render when a task opens.
  const openTask = useCallback((task: Task) => setOpenTaskId(task.id), [])
  const tasksQuery = useTasks({ view: 'today' })
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
  const formattedDate = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(today + 'T00:00:00Z'))

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <header className="ui-rise mb-6 grid overflow-hidden rounded-lg bg-surface sm:grid-cols-[minmax(0,1fr)_34%]">
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

      <div className="mb-4">
        <AddTaskButton variant="secondary" />
      </div>

      {!tasksQuery.data ? (
        <QueryState query={tasksQuery} compact />
      ) : tasks.length === 0 ? (
        <EmptyState title="Nothing due today" />
      ) : (
        <TaskGroupedList groups={groups} onOpenTask={openTask} emptyMessage="Nothing due today" />
      )}

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

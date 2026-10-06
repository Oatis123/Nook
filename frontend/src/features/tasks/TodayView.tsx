import { useCallback, useState } from 'react'
import { CalendarClock } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { useTasks } from '@/features/tasks/hooks'
import { useToday } from '@/features/tasks/useToday'
import { AddTaskButton } from '@/features/tasks/AddTaskButton'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import type { Task } from '@/lib/types'
import { QueryState } from '@/design/components/QueryState'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function TodayView() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  // Stable, so the (memoized) task rows don't all re-render when a task opens.
  const openTask = useCallback((task: Task) => setOpenTaskId(task.id), [])
  const tasksQuery = useTasks({ view: 'today' })
  const today = useToday()
  useDocumentTitle('Today')

  if (!tasksQuery.data) return <QueryState query={tasksQuery} />

  const overdue = tasksQuery.data.filter((t) => t.due_date! < today)
  const dueToday = tasksQuery.data.filter((t) => t.due_date! === today)
  const groups: TaskGroup[] = [
    ...(overdue.length > 0 ? [{ label: 'Overdue', tasks: overdue }] : []),
    ...(dueToday.length > 0 ? [{ label: 'Today', tasks: dueToday }] : []),
  ]

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 font-serif text-2xl text-text">Today</h1>

      <div className="mb-4">
        <AddTaskButton />
      </div>

      {tasksQuery.data.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nothing due today" />
      ) : (
        <TaskGroupedList groups={groups} onOpenTask={openTask} emptyMessage="Nothing due today" />
      )}

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

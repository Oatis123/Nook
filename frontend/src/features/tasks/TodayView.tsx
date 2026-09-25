import { useState } from 'react'
import { CalendarClock } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { useTasks } from '@/features/tasks/hooks'
import { AddTaskButton } from '@/features/tasks/AddTaskButton'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import type { Task } from '@/lib/types'
import { QueryState } from '@/design/components/QueryState'

export default function TodayView() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const tasksQuery = useTasks({ view: 'today' })

  if (!tasksQuery.data) return <QueryState query={tasksQuery} />

  const today = new Date().toISOString().slice(0, 10)
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
        <TaskGroupedList
          groups={groups}
          onOpenTask={(task: Task) => setOpenTaskId(task.id)}
          emptyMessage="Nothing due today"
        />
      )}

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

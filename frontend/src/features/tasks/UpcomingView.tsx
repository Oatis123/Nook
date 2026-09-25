import { useState } from 'react'
import { addDays, format } from 'date-fns'
import { CalendarRange } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { useTasks } from '@/features/tasks/hooks'
import { AddTaskButton } from '@/features/tasks/AddTaskButton'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import type { Task } from '@/lib/types'
import { QueryState } from '@/design/components/QueryState'

const UPCOMING_DAYS = 7

export default function UpcomingView() {
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const tasksQuery = useTasks({ view: 'upcoming' })

  if (!tasksQuery.data) return <QueryState query={tasksQuery} />

  const today = new Date()
  const days = Array.from({ length: UPCOMING_DAYS }, (_, i) => addDays(today, i))
  const lastDay = format(days[days.length - 1], 'yyyy-MM-dd')

  const byDate = new Map<string, Task[]>()
  const later: Task[] = []
  for (const task of tasksQuery.data) {
    if (task.due_date! <= lastDay) {
      const list = byDate.get(task.due_date!) ?? []
      list.push(task)
      byDate.set(task.due_date!, list)
    } else {
      later.push(task)
    }
  }

  const groups: TaskGroup[] = days
    .map((day) => {
      const key = format(day, 'yyyy-MM-dd')
      return { label: format(day, 'EEEE, MMM d'), tasks: byDate.get(key) ?? [] }
    })
    .filter((g) => g.tasks.length > 0)

  if (later.length > 0) groups.push({ label: 'Later', tasks: later })

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 font-serif text-2xl text-text">Upcoming</h1>

      <div className="mb-4">
        <AddTaskButton />
      </div>

      {tasksQuery.data.length === 0 ? (
        <EmptyState icon={CalendarRange} title="Nothing coming up" />
      ) : (
        <TaskGroupedList
          groups={groups}
          onOpenTask={(task: Task) => setOpenTaskId(task.id)}
          emptyMessage="Nothing coming up"
        />
      )}

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

import { TaskRow } from '@/features/tasks/TaskRow'
import type { TaskGroup } from '@/features/tasks/groupTasks'
import type { Task } from '@/lib/types'

export function TaskGroupedList({
  groups,
  onOpenTask,
  emptyMessage,
}: {
  groups: TaskGroup[]
  onOpenTask: (task: Task) => void
  emptyMessage: string
}) {
  if (groups.length === 0) {
    return <p className="px-2 py-6 text-center text-sm text-text-muted">{emptyMessage}</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <div key={group.label || 'ungrouped'}>
          {group.label && (
            <h3 className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              {group.label}
            </h3>
          )}
          <div className="flex flex-col gap-0.5">
            {group.tasks.map((task) => (
              <TaskRow key={task.id} task={task} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

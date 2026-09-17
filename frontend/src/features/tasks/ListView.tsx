import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { EmptyState } from '@/design/components/EmptyState'
import { Switch } from '@/design/components/Switch'
import { useTaskLists, useTasks } from '@/features/tasks/hooks'
import { QuickAdd } from '@/features/tasks/QuickAdd'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import { groupByDate, groupByPriority, noGrouping } from '@/features/tasks/groupTasks'
import { LIST_ICON_COMPONENT, listColorVar } from '@/features/tasks/listStyle'
import type { Task } from '@/lib/types'

type GroupBy = 'none' | 'date' | 'priority'

export default function ListView() {
  const { listId } = useParams<{ listId: string }>()
  const [showCompleted, setShowCompleted] = useState(false)
  const [groupBy, setGroupBy] = useState<GroupBy>('date')
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  const taskListsQuery = useTaskLists()
  const tasksQuery = useTasks({ listId, status: showCompleted ? 'all' : 'open' })

  if (!listId) return null
  const list = taskListsQuery.data?.find((l) => l.id === listId)
  if (!list || !tasksQuery.data) return null

  const Icon = LIST_ICON_COMPONENT[list.icon]
  const groups =
    groupBy === 'priority'
      ? groupByPriority(tasksQuery.data)
      : groupBy === 'date'
        ? groupByDate(tasksQuery.data)
        : noGrouping(tasksQuery.data)

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex items-center gap-2.5">
        <Icon size={20} strokeWidth={1.5} style={{ color: listColorVar(list.color) }} />
        <h1 className="font-serif text-2xl text-text">{list.name}</h1>
      </div>

      <div className="mb-4">
        <QuickAdd listId={listId} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="inline-flex rounded-md border border-border bg-bg p-0.5 text-sm">
          {(['none', 'date', 'priority'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setGroupBy(mode)}
              className={clsx(
                'rounded px-2.5 py-1 capitalize transition-colors duration-150',
                groupBy === mode
                  ? 'bg-surface-raised text-text shadow-sm'
                  : 'text-text-muted hover:text-text',
              )}
            >
              {mode === 'none' ? 'No grouping' : mode}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-text-muted">
          <Switch
            checked={showCompleted}
            onCheckedChange={setShowCompleted}
            label="Show completed"
          />
          Show completed
        </label>
      </div>

      {tasksQuery.data.length === 0 ? (
        <EmptyState icon={Icon} title="No tasks here yet" />
      ) : (
        <TaskGroupedList
          groups={groups}
          onOpenTask={(task: Task) => setOpenTaskId(task.id)}
          emptyMessage="No tasks here yet"
        />
      )}

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
    </div>
  )
}

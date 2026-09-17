import { useState } from 'react'
import { clsx } from 'clsx'
import { Flag } from 'lucide-react'
import { ApiError } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useCompleteTask, useReopenTask } from '@/features/tasks/hooks'
import { PRIORITY_COLOR_VAR } from '@/features/tasks/priority'
import { CompleteSubtasksDialog } from '@/features/tasks/CompleteSubtasksDialog'
import type { Task } from '@/lib/types'

function isOverdue(task: Task): boolean {
  if (task.status === 'done' || !task.due_date) return false
  return task.due_date < new Date().toISOString().slice(0, 10)
}

export function TaskRow({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const completeTask = useCompleteTask()
  const reopenTask = useReopenTask()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const done = task.status === 'done'

  async function handleToggle() {
    if (done) {
      reopenTask.mutate(task.id)
      return
    }
    try {
      await completeTask.mutateAsync({ id: task.id })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConfirmOpen(true)
        return
      }
      throw error
    }
  }

  return (
    <div className="group flex items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-surface-raised">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={clsx(
          'mt-0.5 h-4 w-4 shrink-0 rounded-full border transition-colors duration-150',
          done ? 'border-accent bg-accent' : 'border-border hover:border-accent',
        )}
      />

      <button type="button" onClick={() => onOpen(task)} className="min-w-0 flex-1 text-left">
        <div className="flex items-center gap-1.5">
          {task.priority !== 'none' && (
            <Flag
              size={12}
              strokeWidth={2}
              style={{ color: PRIORITY_COLOR_VAR[task.priority as 'low' | 'medium' | 'high'] }}
              className="shrink-0"
            />
          )}
          <span
            className={clsx(
              'truncate text-sm',
              done ? 'text-text-muted line-through' : 'text-text',
            )}
          >
            {task.title}
          </span>
          {task.subtask_total_count > 0 && (
            <span className="shrink-0 text-xs text-text-muted">
              {task.subtask_done_count}/{task.subtask_total_count}
            </span>
          )}
        </div>
        {task.due_date && (
          <span className={clsx('text-xs', isOverdue(task) ? 'text-danger' : 'text-text-muted')}>
            {formatDate(task.due_date)}
            {task.due_time && ` ${task.due_time.slice(0, 5)}`}
          </span>
        )}
      </button>

      <CompleteSubtasksDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => completeTask.mutate({ id: task.id, completeSubtasks: true })}
      />
    </div>
  )
}

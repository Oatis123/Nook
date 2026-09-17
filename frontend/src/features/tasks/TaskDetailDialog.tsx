import { useState } from 'react'
import { clsx } from 'clsx'
import { Trash2 } from 'lucide-react'
import { Dialog } from '@/design/components/Dialog'
import { Switch } from '@/design/components/Switch'
import { ApiError } from '@/lib/api'
import {
  useCompleteTask,
  useDeleteTask,
  useReopenTask,
  useTask,
  useTaskLists,
  useUpdateTask,
} from '@/features/tasks/hooks'
import { PRIORITY_COLOR_VAR, PRIORITY_LABEL } from '@/features/tasks/priority'
import { CompleteSubtasksDialog } from '@/features/tasks/CompleteSubtasksDialog'
import { QuickAdd } from '@/features/tasks/QuickAdd'
import type { Task, TaskPriority } from '@/lib/types'

const selectClass =
  'h-8 rounded-md border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent'

function SubtaskRow({ subtask }: { subtask: Task }) {
  const completeTask = useCompleteTask()
  const reopenTask = useReopenTask()
  const deleteTask = useDeleteTask()
  const done = subtask.status === 'done'

  return (
    <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface">
      <button
        type="button"
        onClick={() =>
          done ? reopenTask.mutate(subtask.id) : completeTask.mutate({ id: subtask.id })
        }
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
        className={clsx(
          'h-3.5 w-3.5 shrink-0 rounded-full border transition-colors duration-150',
          done ? 'border-accent bg-accent' : 'border-border hover:border-accent',
        )}
      />
      <span
        className={clsx(
          'flex-1 truncate text-sm',
          done ? 'text-text-muted line-through' : 'text-text',
        )}
      >
        {subtask.title}
      </span>
      <button
        type="button"
        onClick={() => deleteTask.mutate(subtask.id)}
        aria-label={`Delete ${subtask.title}`}
        className="shrink-0 text-text-muted opacity-0 hover:text-danger group-hover:opacity-100"
      >
        <Trash2 size={13} strokeWidth={1.5} />
      </button>
    </div>
  )
}

export function TaskDetailDialog({
  taskId,
  onOpenChange,
}: {
  taskId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const taskQuery = useTask(taskId ?? undefined)
  const updateTask = useUpdateTask()
  const completeTask = useCompleteTask()
  const reopenTask = useReopenTask()
  const deleteTask = useDeleteTask()
  const taskListsQuery = useTaskLists()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [loadedTaskId, setLoadedTaskId] = useState<string | null>(null)

  const task = taskQuery.data

  // Reset the editable fields whenever a different task loads, but not on every
  // background refetch of the same task — adjusted during render (React's documented
  // pattern) rather than in an effect, since it only needs to happen once per task id.
  if (task && loadedTaskId !== task.id) {
    setTitle(task.title)
    setDescription(task.description ?? '')
    setLoadedTaskId(task.id)
  }
  if (!task) return null

  async function handleToggleDone() {
    if (task!.status === 'done') {
      reopenTask.mutate(task!.id)
      return
    }
    try {
      await completeTask.mutateAsync({ id: task!.id })
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setConfirmOpen(true)
        return
      }
      throw error
    }
  }

  return (
    <Dialog open={taskId !== null} onOpenChange={onOpenChange} title="Task">
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={handleToggleDone}
            aria-label={task.status === 'done' ? 'Mark as not done' : 'Mark as done'}
            className={clsx(
              'mt-1 h-4 w-4 shrink-0 rounded-full border transition-colors duration-150',
              task.status === 'done'
                ? 'border-accent bg-accent'
                : 'border-border hover:border-accent',
            )}
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title.trim() && title !== task.title) {
                updateTask.mutate({ id: task.id, title: title.trim() })
              }
            }}
            className={clsx(
              'w-full bg-transparent text-base outline-none',
              task.status === 'done' ? 'text-text-muted line-through' : 'text-text',
            )}
          />
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            if (description !== (task.description ?? '')) {
              updateTask.mutate({ id: task.id, description })
            }
          }}
          placeholder="Description (markdown)"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:border-accent"
        />

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={task.priority}
            onChange={(e) =>
              updateTask.mutate({ id: task.id, priority: e.target.value as TaskPriority })
            }
            className={selectClass}
            style={
              task.priority !== 'none'
                ? { color: PRIORITY_COLOR_VAR[task.priority as 'low' | 'medium' | 'high'] }
                : undefined
            }
          >
            {(Object.keys(PRIORITY_LABEL) as TaskPriority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABEL[p]}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={task.due_date ?? ''}
            onChange={(e) =>
              e.target.value
                ? updateTask.mutate({ id: task.id, due_date: e.target.value })
                : updateTask.mutate({ id: task.id, clear_due_date: true })
            }
            className={selectClass}
          />

          {task.due_date && (
            <input
              type="time"
              value={task.due_time?.slice(0, 5) ?? ''}
              onChange={(e) =>
                e.target.value
                  ? updateTask.mutate({ id: task.id, due_time: `${e.target.value}:00` })
                  : updateTask.mutate({ id: task.id, clear_due_time: true })
              }
              className={selectClass}
            />
          )}

          {!task.parent_id && (
            <select
              value={task.list_id}
              onChange={(e) => updateTask.mutate({ id: task.id, list_id: e.target.value })}
              className={selectClass}
            >
              {taskListsQuery.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <Switch
            checked={task.reminders_enabled}
            onCheckedChange={(checked) =>
              updateTask.mutate({ id: task.id, reminders_enabled: checked })
            }
            label="Reminders enabled"
          />
          Reminders
        </label>

        {!task.parent_id && (
          <div>
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              Subtasks
            </h3>
            <div className="flex flex-col gap-0.5">
              {task.subtasks.map((subtask) => (
                <SubtaskRow key={subtask.id} subtask={subtask} />
              ))}
            </div>
            <div className="mt-2">
              <QuickAdd parentId={task.id} />
            </div>
          </div>
        )}

        <div className="flex justify-end border-t border-border pt-3">
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete "${task.title}"?`)) {
                deleteTask.mutate(task.id)
                onOpenChange(false)
              }
            }}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-danger"
          >
            <Trash2 size={14} strokeWidth={1.5} />
            Delete task
          </button>
        </div>
      </div>

      <CompleteSubtasksDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={() => completeTask.mutate({ id: task.id, completeSubtasks: true })}
      />
    </Dialog>
  )
}

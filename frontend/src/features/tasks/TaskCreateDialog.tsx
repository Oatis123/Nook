import { type FormEvent, useState } from 'react'
import { Repeat } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { Switch } from '@/design/components/Switch'
import { useCreateTask, useTaskLists } from '@/features/tasks/hooks'
import { PRIORITY_COLOR_VAR, PRIORITY_LABEL } from '@/features/tasks/priority'
import { RecurrencePicker } from '@/features/tasks/RecurrencePicker'
import { describeRecurrenceInput } from '@/features/tasks/recurrenceLabel'
import type { RecurrenceInput, TaskPriority } from '@/lib/types'

const selectClass =
  'h-9 rounded-md border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent'

export function TaskCreateDialog({
  open,
  onOpenChange,
  title: dialogTitle = 'New task',
  listId,
  defaultDate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  /** Preselects (but doesn't lock) the list — e.g. opened from a specific list's page. */
  listId?: string
  /** Preselects the due date — e.g. opened by clicking a day on the calendar. */
  defaultDate?: string | null
}) {
  const createTask = useCreateTask()
  const taskListsQuery = useTaskLists()
  const [recurrenceOpen, setRecurrenceOpen] = useState(false)
  const [wasOpen, setWasOpen] = useState(open)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('none')
  const [dueDate, setDueDate] = useState('')
  const [dueTime, setDueTime] = useState('')
  const [selectedListId, setSelectedListId] = useState<string | undefined>(listId)
  const [remindersEnabled, setRemindersEnabled] = useState(true)
  const [recurrence, setRecurrence] = useState<RecurrenceInput | null>(null)

  // Reset (and re-seed from props) whenever the dialog transitions to open — adjusted
  // during render, matching the pattern RecurrencePicker/TaskListEditDialog already use
  // for reusable dialogs in this app, rather than an effect.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setTitle('')
      setDescription('')
      setPriority('none')
      setDueDate(defaultDate ?? '')
      setDueTime('')
      setSelectedListId(
        listId ?? taskListsQuery.data?.find((l) => l.is_inbox)?.id ?? taskListsQuery.data?.[0]?.id,
      )
      setRemindersEnabled(true)
      setRecurrence(null)
    }
  }

  // A recurring task needs a time for its first occurrence (spec §7.4) — see QuickAdd's
  // needsTimeForRecurrence for the same rule on the old text-entry path.
  const canRepeat = dueDate !== '' && dueTime !== ''

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) return
    createTask.mutate(
      {
        title: trimmed,
        description: description.trim() || undefined,
        list_id: selectedListId,
        priority,
        due_date: dueDate || undefined,
        due_time: dueTime || undefined,
        reminders_enabled: remindersEnabled,
        recurrence: canRepeat ? recurrence : undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={dialogTitle}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none placeholder:text-text-muted focus-visible:border-accent"
        />

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (markdown, optional)"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:border-accent"
        />

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className={selectClass}
            style={
              priority !== 'none'
                ? { color: PRIORITY_COLOR_VAR[priority as 'low' | 'medium' | 'high'] }
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
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={selectClass}
          />

          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className={selectClass}
          />

          {taskListsQuery.data && taskListsQuery.data.length > 0 && (
            <select
              value={selectedListId ?? ''}
              onChange={(e) => setSelectedListId(e.target.value)}
              className={selectClass}
            >
              {taskListsQuery.data.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!canRepeat}
            onClick={() => setRecurrenceOpen(true)}
            className={clsx('gap-1.5', recurrence && 'border-accent text-accent')}
          >
            <Repeat size={13} strokeWidth={1.5} />
            {recurrence ? describeRecurrenceInput(recurrence) : 'Repeat'}
          </Button>
        </div>

        {!canRepeat && (
          <p className="text-xs text-text-muted">Set a due date and time to make this repeat.</p>
        )}

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <Switch
            checked={remindersEnabled}
            onCheckedChange={setRemindersEnabled}
            label="Reminders enabled"
          />
          Reminders
        </label>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!title.trim()}>
            Create task
          </Button>
        </div>
      </form>

      <RecurrencePicker
        open={recurrenceOpen}
        onOpenChange={setRecurrenceOpen}
        hasExisting={recurrence !== null}
        onSave={setRecurrence}
        onRemove={() => setRecurrence(null)}
      />
    </Dialog>
  )
}

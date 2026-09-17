import { type FormEvent, useState } from 'react'
import { format } from 'date-fns'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { useCreateTask } from '@/features/tasks/hooks'

export function QuickCreateOnDateDialog({
  date,
  onOpenChange,
}: {
  date: Date | null
  onOpenChange: (open: boolean) => void
}) {
  const [title, setTitle] = useState('')
  const createTask = useCreateTask()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim() || !date) return
    createTask.mutate(
      { title: title.trim(), due_date: format(date, 'yyyy-MM-dd') },
      {
        onSuccess: () => {
          setTitle('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog
      open={date !== null}
      onOpenChange={onOpenChange}
      title={date ? `New task on ${format(date, 'MMM d, yyyy')}` : 'New task'}
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Create
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

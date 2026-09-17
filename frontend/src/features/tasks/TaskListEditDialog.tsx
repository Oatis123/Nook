import { type FormEvent, useState } from 'react'
import { clsx } from 'clsx'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { useCreateTaskList, useUpdateTaskList } from '@/features/tasks/hooks'
import {
  LIST_COLOR_OPTIONS,
  LIST_ICON_COMPONENT,
  LIST_ICON_OPTIONS,
  listColorVar,
} from '@/features/tasks/listStyle'
import type { TaskList, TaskListColor, TaskListIcon } from '@/lib/types'

export function TaskListEditDialog({
  list,
  open,
  onOpenChange,
}: {
  /** null while creating a new list; an existing list while editing one. */
  list: TaskList | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const createList = useCreateTaskList()
  const updateList = useUpdateTaskList()
  const [name, setName] = useState('')
  const [color, setColor] = useState<TaskListColor>('palette-1')
  const [icon, setIcon] = useState<TaskListIcon>('folder')
  const [wasOpen, setWasOpen] = useState(open)

  // Reset the form fields whenever the dialog transitions to open — adjusted during
  // render (React's documented pattern) rather than in an effect, since this dialog is
  // reused across both "create" and "edit" (with different `list` props) and only needs
  // to re-seed once per open, not on every render while it stays open.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName(list?.name ?? '')
      setColor(list?.color ?? 'palette-1')
      setIcon(list?.icon ?? 'folder')
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    if (list) {
      updateList.mutate(
        { id: list.id, name: name.trim(), color, icon },
        { onSuccess: () => onOpenChange(false) },
      )
    } else {
      createList.mutate(
        { name: name.trim(), color, icon },
        { onSuccess: () => onOpenChange(false) },
      )
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={list ? 'Edit list' : 'New list'}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="List name"
          className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
        />

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">
            Color
          </p>
          <div className="flex flex-wrap gap-2">
            {LIST_COLOR_OPTIONS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={c}
                className={clsx(
                  'h-6 w-6 rounded-full ring-offset-2 ring-offset-surface-raised transition-shadow',
                  color === c && 'ring-2 ring-accent',
                )}
                style={{ backgroundColor: listColorVar(c) }}
              />
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Icon</p>
          <div className="flex flex-wrap gap-1.5">
            {LIST_ICON_OPTIONS.map((iconKey) => {
              const IconComponent = LIST_ICON_COMPONENT[iconKey]
              return (
                <button
                  key={iconKey}
                  type="button"
                  onClick={() => setIcon(iconKey)}
                  aria-label={iconKey}
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-md border transition-colors duration-150',
                    icon === iconKey
                      ? 'border-accent bg-surface text-accent'
                      : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  <IconComponent size={15} strokeWidth={1.5} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {list ? 'Save' : 'Create list'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { TaskCreateDialog } from '@/features/tasks/TaskCreateDialog'

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

/** Opens TaskCreateDialog — the row it renders stands in for the old inline QuickAdd text
 * field, keeping the same look and the same Q/Ctrl+N shortcut, but every field (due time,
 * recurrence, priority, ...) now has a real control instead of typed shorthand. */
export function AddTaskButton({ listId }: { listId?: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut = e.key.toLowerCase() === 'q' || ((e.metaKey || e.ctrlKey) && e.key === 'n')
      if (!isShortcut || isTypingInField(e.target)) return
      e.preventDefault()
      setOpen(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm text-text-muted transition-colors duration-150 hover:text-text"
      >
        <Plus size={16} strokeWidth={1.5} className="shrink-0" />
        Add a task… (Q)
      </button>
      <TaskCreateDialog open={open} onOpenChange={setOpen} listId={listId} />
    </>
  )
}

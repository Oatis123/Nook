import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Repeat } from 'lucide-react'
import { formatDate } from '@/lib/format'
import { useCreateTask, useTaskLists } from '@/features/tasks/hooks'
import { parseQuickAdd } from '@/features/tasks/quickAddParser'
import { computeDefaultRecurrenceStartDate } from '@/features/tasks/recurrencePhrase'
import { describeRecurrenceInput } from '@/features/tasks/recurrenceLabel'
import { PRIORITY_COLOR_VAR, PRIORITY_LABEL } from '@/features/tasks/priority'

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable
}

export function QuickAdd({ listId, parentId }: { listId?: string; parentId?: string }) {
  const [text, setText] = useState('')
  const createTask = useCreateTask()
  const taskListsQuery = useTaskLists()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isShortcut = e.key.toLowerCase() === 'q' || ((e.metaKey || e.ctrlKey) && e.key === 'n')
      if (!isShortcut || isTypingInField(e.target)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const parsed = useMemo(() => (text.trim() ? parseQuickAdd(text) : null), [text])
  const matchedList = useMemo(() => {
    if (!parsed?.listName || !taskListsQuery.data) return undefined
    return taskListsQuery.data.find((l) => l.name.toLowerCase() === parsed.listName?.toLowerCase())
  }, [parsed, taskListsQuery.data])

  // An unmatched #tag isn't a real list, so it stays part of the title instead of
  // silently vanishing (the parser always strips it — this puts it back when it
  // didn't resolve to anything).
  const finalTitle =
    parsed?.listName && !matchedList ? `${parsed.title} #${parsed.listName}`.trim() : parsed?.title

  // A recurring task needs a time for its first occurrence (spec §7.4) — quick add can
  // infer a start date on its own (today, or the next matching weekday) but can't guess a
  // time, so submission is blocked until the user adds one.
  const needsTimeForRecurrence =
    parsed?.recurrence !== null && parsed?.recurrence !== undefined && !parsed.dueTime

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!finalTitle || needsTimeForRecurrence) return
    createTask.mutate(
      {
        title: finalTitle,
        list_id: parentId ? undefined : (matchedList?.id ?? listId),
        parent_id: parentId,
        priority: parsed?.priority ?? undefined,
        due_date:
          parsed?.dueDate ??
          (parsed?.recurrence ? computeDefaultRecurrenceStartDate(parsed.recurrence) : undefined),
        due_time: parsed?.dueTime ?? undefined,
        recurrence: parsed?.recurrence ?? undefined,
      },
      { onSuccess: () => setText('') },
    )
  }

  const showChips =
    parsed && (parsed.dueDate || parsed.priority || parsed.listName || parsed.recurrence)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <Plus size={16} strokeWidth={1.5} className="shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a task… try “tomorrow 6pm !high #Personal” (Q)"
          className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        />
      </div>
      {showChips && (
        <div className="flex flex-wrap gap-1.5 px-1">
          {parsed.dueDate && (
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">
              {formatDate(parsed.dueDate)}
              {parsed.dueTime && ` ${parsed.dueTime.slice(0, 5)}`}
            </span>
          )}
          {parsed.priority && (
            <span
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs"
              style={{ color: PRIORITY_COLOR_VAR[parsed.priority as 'low' | 'medium' | 'high'] }}
            >
              {PRIORITY_LABEL[parsed.priority]}
            </span>
          )}
          {parsed.listName && matchedList && (
            <span className="rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">
              {matchedList.name}
            </span>
          )}
          {parsed.recurrence && (
            <span className="flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-text-muted">
              <Repeat size={11} strokeWidth={1.5} />
              {describeRecurrenceInput(parsed.recurrence)}
            </span>
          )}
          {needsTimeForRecurrence && (
            <span className="rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-xs text-danger">
              Add a time, e.g. “9am”
            </span>
          )}
        </div>
      )}
    </form>
  )
}

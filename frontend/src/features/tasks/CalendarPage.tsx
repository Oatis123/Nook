import { type DragEvent, useState } from 'react'
import { clsx } from 'clsx'
import {
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subMonths,
  subWeeks,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus, Repeat } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { useCalendar, useTaskLists, useUpdateTask } from '@/features/tasks/hooks'
import { listColorVar, listTintVar } from '@/features/tasks/listStyle'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import { TaskCreateDialog } from '@/features/tasks/TaskCreateDialog'
import { useToday } from '@/features/tasks/useToday'
import { parseLocalDate } from '@/lib/dates'
import { isClickDrag } from '@/lib/dragClick'
import type { CalendarEntry, TaskListColor } from '@/lib/types'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

type ViewMode = 'month' | 'week'
const DRAG_MIME = 'application/x-nook-calendar-entry'

function monthRange(anchor: Date) {
  return {
    start: startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 }),
  }
}

function weekRange(anchor: Date) {
  return {
    start: startOfWeek(anchor, { weekStartsOn: 1 }),
    end: endOfWeek(anchor, { weekStartsOn: 1 }),
  }
}

function groupByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>()
  for (const entry of entries) {
    const list = map.get(entry.date) ?? []
    list.push(entry)
    map.set(entry.date, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''))
  }
  return map
}

/** A task on a day, in its list's colors: the list's tint behind it and a small mark in
 * its ink (oatis-style category marks). A high-priority task's mark and title are ochre —
 * the "look here" color — instead; a future repeat is a dashed outline with no fill. */
function EntryChip({
  entry,
  listColor,
  onOpen,
}: {
  entry: CalendarEntry
  listColor: TaskListColor | undefined
  onOpen: () => void
}) {
  const high = entry.priority === 'high'
  const ink = listColor ? listColorVar(listColor) : 'var(--text-muted)'
  return (
    <button
      type="button"
      draggable={!entry.virtual}
      onDragStart={(e) => {
        if (entry.virtual) return
        e.dataTransfer.setData(DRAG_MIME, entry.task_id)
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      className={clsx(
        'flex w-full items-center gap-1.5 truncate px-1 py-0.5 text-left text-xs text-text hover:brightness-110',
        entry.virtual && 'border border-dashed border-(--oatis-dim) text-text-muted',
      )}
      style={!entry.virtual && listColor ? { backgroundColor: listTintVar(listColor) } : undefined}
    >
      <span
        className="h-1.5 w-1.5 shrink-0"
        style={{ backgroundColor: high ? 'var(--danger)' : ink }}
      />
      {entry.virtual && <Repeat size={9} className="shrink-0" />}
      {entry.time && (
        <span className="shrink-0 tabular-nums" style={{ color: entry.virtual ? undefined : ink }}>
          {entry.time.slice(0, 5)}
        </span>
      )}
      <span className={clsx('truncate', high && 'text-danger')}>{entry.title}</span>
    </button>
  )
}

export default function CalendarPage() {
  // Mobile defaults to the week agenda (spec §10.8: calendar -> week/agenda below 768px);
  // desktop keeps the existing month default.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== 'undefined' && window.innerWidth < 768 ? 'week' : 'month',
  )
  const today = useToday()
  useDocumentTitle('Calendar')
  const [anchorDate, setAnchorDate] = useState(() => parseLocalDate(today))
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [quickCreateDate, setQuickCreateDate] = useState<Date | null>(null)

  const range = viewMode === 'month' ? monthRange(anchorDate) : weekRange(anchorDate)
  const taskListsQuery = useTaskLists()
  const listColors = new Map(taskListsQuery.data?.map((l) => [l.id, l.color]))
  const calendarQuery = useCalendar(
    format(range.start, 'yyyy-MM-dd'),
    format(range.end, 'yyyy-MM-dd'),
  )
  const updateTask = useUpdateTask()

  const entriesByDate = groupByDate(calendarQuery.data ?? [])
  const days = eachDayOfInterval(range)

  function goPrev() {
    setAnchorDate(viewMode === 'month' ? subMonths(anchorDate, 1) : subWeeks(anchorDate, 1))
  }
  function goNext() {
    setAnchorDate(viewMode === 'month' ? addMonths(anchorDate, 1) : addWeeks(anchorDate, 1))
  }

  function handleDrop(e: DragEvent, day: Date) {
    e.preventDefault()
    setDragOverDate(null)
    // A click that moved the pointer a little (see lib/dragClick), not a reschedule.
    if (isClickDrag()) return
    const taskId = e.dataTransfer.getData(DRAG_MIME)
    if (taskId) updateTask.mutate({ id: taskId, due_date: format(day, 'yyyy-MM-dd') })
  }

  function handleDayClick(day: Date) {
    setQuickCreateDate(day)
  }

  return (
    <div className="flex h-full flex-col px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-2xl text-text">
            {viewMode === 'month'
              ? format(anchorDate, 'MMMM yyyy')
              : `Week of ${format(range.start, 'MMM d')}`}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => setAnchorDate(parseLocalDate(today))}>
            Today
          </Button>
          <IconNavButton
            onClick={goPrev}
            icon={<ChevronLeft size={16} strokeWidth={1.5} />}
            label="Previous"
          />
          <IconNavButton
            onClick={goNext}
            icon={<ChevronRight size={16} strokeWidth={1.5} />}
            label="Next"
          />
          <div className="inline-flex border border-border bg-bg p-0.5 text-sm">
            {(['month', 'week'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={clsx(
                  'px-2.5 py-1 capitalize transition-colors duration-150',
                  viewMode === mode
                    ? 'bg-surface-raised text-text'
                    : 'text-text-muted hover:text-text',
                )}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* < 768px: a scrollable day-by-day agenda instead of the 7-column grid, which has
          no room for readable dates/chips or 44px touch targets below that width. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:hidden">
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const entries = entriesByDate.get(key) ?? []
          return (
            <div key={key} className="border-b border-border py-1">
              <button
                type="button"
                onClick={() => handleDayClick(day)}
                className={clsx(
                  'flex min-h-11 w-full items-center justify-between gap-2 px-2 text-left',
                  format(day, 'yyyy-MM-dd') === today ? 'text-accent' : 'text-text',
                )}
              >
                <span className="text-sm font-medium">{format(day, 'EEE, MMM d')}</span>
                <Plus size={15} strokeWidth={1.5} className="shrink-0 text-text-muted" />
              </button>
              {entries.length > 0 && (
                <div className="flex flex-col gap-0.5 px-2 pb-1">
                  {entries.map((entry) => (
                    <EntryChip
                      key={`${entry.task_id}-${entry.date}`}
                      entry={entry}
                      listColor={listColors.get(entry.list_id)}
                      onOpen={() => setOpenTaskId(entry.task_id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="hidden min-h-0 flex-1 grid-cols-7 gap-px overflow-hidden border border-border bg-border md:grid">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
          <div key={label} className="bg-surface px-2 py-1 text-center text-xs text-text-muted">
            {label}
          </div>
        ))}
        {days.map((day) => {
          const key = format(day, 'yyyy-MM-dd')
          const entries = entriesByDate.get(key) ?? []
          const dimmed = viewMode === 'month' && !isSameMonth(day, anchorDate)
          return (
            <div
              key={key}
              onDragOver={(e) => {
                e.preventDefault()
                setDragOverDate(key)
              }}
              onDragLeave={() => setDragOverDate((d) => (d === key ? null : d))}
              onDrop={(e) => handleDrop(e, day)}
              onClick={() => handleDayClick(day)}
              className={clsx(
                'flex min-h-24 flex-col gap-0.5 bg-surface-raised p-1.5',
                dimmed && 'bg-surface text-text-muted',
                dragOverDate === key && 'ring-2 ring-inset ring-accent',
              )}
            >
              <span
                className={clsx(
                  'self-start px-1.5 text-xs',
                  format(day, 'yyyy-MM-dd') === today
                    ? 'bg-accent text-accent-text'
                    : 'text-text-muted',
                )}
              >
                {format(day, 'd')}
              </span>
              <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
                {entries.map((entry) => (
                  <EntryChip
                    key={`${entry.task_id}-${entry.date}`}
                    entry={entry}
                    listColor={listColors.get(entry.list_id)}
                    onOpen={() => setOpenTaskId(entry.task_id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-xs text-text-muted">
        Click a day to add a task there. Drag a task to move it (dashed chips are future occurrences
        of a repeating task and aren't yet real tasks).
      </p>

      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
      <TaskCreateDialog
        open={quickCreateDate !== null}
        onOpenChange={(open) => !open && setQuickCreateDate(null)}
        title={
          quickCreateDate ? `New task on ${format(quickCreateDate, 'MMM d, yyyy')}` : 'New task'
        }
        defaultDate={quickCreateDate ? format(quickCreateDate, 'yyyy-MM-dd') : null}
      />
    </div>
  )
}

function IconNavButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center text-text-muted hover:bg-surface-raised hover:text-text"
    >
      {icon}
    </button>
  )
}

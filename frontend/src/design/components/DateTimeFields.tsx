import { type KeyboardEvent, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { clsx } from 'clsx'
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight } from '@/design/icons'
import { useToday } from '@/features/tasks/useToday'
import { parseLocalDate, parseTypedTime } from '@/lib/dates'

/* Date and time fields drawn in the app's own theme, replacing the browser's native
   pickers (which ignore it). Values stay the same plain strings the API uses:
   `YYYY-MM-DD` for dates, `HH:MM` for times, '' for "not set". */

const triggerClass =
  'ui-field-trigger flex items-center gap-1.5 border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent data-[state=open]:border-accent'
const popoverClass =
  'ui-menu ui-glass z-[60] border border-border bg-surface-raised p-2 animate-fade-in'
const smallButtonClass =
  'px-2 py-1 text-xs text-text-muted outline-none hover:bg-surface hover:text-text focus-visible:bg-surface focus-visible:text-text'

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function ymd(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function Calendar({
  value,
  today,
  onPick,
}: {
  value: string
  today: string
  onPick: (value: string) => void
}) {
  const [month, setMonth] = useState(() => startOfMonth(parseLocalDate(value || today)))
  // The day keyboard focus is on; arrows move it, Enter picks it.
  const [focused, setFocused] = useState(value || today)

  const days = eachDayOfInterval({
    start: startOfWeek(month, { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
  })

  function moveFocus(by: number) {
    const next = addDays(parseLocalDate(focused), by)
    setFocused(ymd(next))
    if (!isSameMonth(next, month)) setMonth(startOfMonth(next))
  }

  function onKeyDown(e: KeyboardEvent) {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    if (e.key in moves) {
      e.preventDefault()
      moveFocus(moves[e.key])
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault()
      const next = addMonths(parseLocalDate(focused), e.key === 'PageUp' ? -1 : 1)
      setFocused(ymd(next))
      setMonth(startOfMonth(next))
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onPick(focused)
    }
  }

  return (
    <div className="w-60">
      <div className="mb-1.5 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, -1))}
          aria-label="Previous month"
          className={smallButtonClass}
        >
          <ChevronLeft size={14} strokeWidth={1.5} />
        </button>
        <span className="text-sm text-text">{format(month, 'LLLL yyyy')}</span>
        <button
          type="button"
          onClick={() => setMonth((m) => addMonths(m, 1))}
          aria-label="Next month"
          className={smallButtonClass}
        >
          <ChevronRight size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div
        role="grid"
        aria-label={format(month, 'LLLL yyyy')}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="grid grid-cols-7 gap-0.5 outline-none"
      >
        {WEEKDAYS.map((d) => (
          <span key={d} className="py-1 text-center text-xs text-text-muted">
            {d}
          </span>
        ))}
        {days.map((day) => {
          const key = ymd(day)
          const selected = key === value
          return (
            <button
              key={key}
              type="button"
              tabIndex={-1}
              onClick={() => onPick(key)}
              aria-pressed={selected}
              aria-label={format(day, 'EEEE, MMMM d, yyyy')}
              data-today={key === today || undefined}
              data-focused={key === focused || undefined}
              className={clsx(
                'ui-day h-8 text-sm tabular-nums transition-colors duration-150',
                selected
                  ? 'bg-accent text-accent-text'
                  : isSameMonth(day, month)
                    ? 'text-text hover:bg-surface'
                    : 'text-text-muted opacity-60 hover:bg-surface',
                key === today && !selected && 'ring-1 ring-inset ring-accent',
                key === focused && !selected && 'bg-surface',
              )}
            >
              {day.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** A date field: a button showing the date, opening a month calendar with Today,
 * Tomorrow and (when `clearable`) Clear shortcuts. */
export function DateField({
  value,
  onChange,
  label,
  placeholder = 'Date',
  clearable = true,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  clearable?: boolean
  className?: string
}) {
  const today = useToday()
  const [open, setOpen] = useState(false)

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        aria-label={value ? `${label}: ${format(parseLocalDate(value), 'MMMM d, yyyy')}` : label}
        className={clsx(triggerClass, value ? 'text-text' : 'text-text-muted', className)}
      >
        {value ? format(parseLocalDate(value), 'EEE, MMM d, yyyy') : placeholder}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={popoverClass}
          onOpenAutoFocus={(e) => {
            // Focus the grid so arrow keys work straight away.
            e.preventDefault()
            ;(e.currentTarget as HTMLElement).querySelector<HTMLElement>('[role=grid]')?.focus()
          }}
        >
          <Calendar value={value} today={today} onPick={pick} />
          <div className="mt-2 flex items-center gap-1 border-t border-border pt-2">
            <button type="button" onClick={() => pick(today)} className={smallButtonClass}>
              Today
            </button>
            <button
              type="button"
              onClick={() => pick(ymd(addDays(parseLocalDate(today), 1)))}
              className={smallButtonClass}
            >
              Tomorrow
            </button>
            {clearable && value && (
              <button
                type="button"
                onClick={() => pick('')}
                className={clsx(smallButtonClass, 'ml-auto')}
              >
                Clear
              </button>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTES = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'))
const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00', '21:00']
/** A time field: a button showing HH:MM, opening hour and minute columns, a few presets
 * and a box to type any time ("9:40"). */
export function TimeField({
  value,
  onChange,
  label,
  placeholder = 'Time',
  clearable = true,
  className,
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  clearable?: boolean
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [hour, minute] = value ? value.split(':') : ['', '']

  function pick(next: string, close = true) {
    onChange(next)
    if (close) setOpen(false)
  }

  function column(items: string[], current: string, onSelect: (item: string) => void) {
    return (
      <div className="flex max-h-48 flex-col overflow-y-auto pr-0.5">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            aria-pressed={item === current}
            ref={(el) => {
              if (el && item === current) el.scrollIntoView({ block: 'center' })
            }}
            className={clsx(
              'px-2.5 py-1 text-sm tabular-nums',
              item === current ? 'bg-accent text-accent-text' : 'text-text hover:bg-surface',
            )}
          >
            {item}
          </button>
        ))}
      </div>
    )
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setTyped('')
      }}
    >
      <Popover.Trigger
        type="button"
        aria-label={value ? `${label}: ${value}` : label}
        className={clsx(
          triggerClass,
          'tabular-nums',
          value ? 'text-text' : 'text-text-muted',
          className,
        )}
      >
        {value || placeholder}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className={popoverClass}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const parsed = parseTypedTime(typed)
              if (parsed) pick(parsed)
            }}
          >
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type, e.g. 9:40"
              aria-label={`${label}, typed`}
              aria-invalid={typed !== '' && parseTypedTime(typed) === null ? true : undefined}
              className="mb-2 h-8 w-full border border-border bg-surface px-2 text-sm text-text outline-none placeholder:text-text-muted focus-visible:border-accent aria-invalid:border-danger"
            />
          </form>
          <div className="flex gap-2">
            {column(HOURS, hour, (h) => pick(`${h}:${minute || '00'}`, false))}
            {column(MINUTES, minute, (m) => pick(`${hour || '09'}:${m}`))}
            <div className="flex flex-col gap-0.5 border-l border-border pl-2">
              {TIME_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => pick(preset)}
                  className={clsx(smallButtonClass, 'tabular-nums')}
                >
                  {preset}
                </button>
              ))}
              {clearable && value && (
                <button
                  type="button"
                  onClick={() => pick('')}
                  className={clsx(smallButtonClass, 'mt-auto')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

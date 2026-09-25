import { clsx } from 'clsx'
import type { RecurrenceFreq, RecurrenceInput } from '@/lib/types'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const selectClass =
  'h-8 rounded-md border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent'

export const DEFAULT_RECURRENCE: RecurrenceInput = {
  freq: 'weekly',
  interval: 1,
  end_type: 'never',
}

/** The interval/frequency/weekday/monthly/end-condition fields shared by the inline
 * recurring-mode form (TaskCreateDialog) and the edit popup (RecurrencePicker). */
export function RecurrenceFields({
  value,
  onChange,
}: {
  value: RecurrenceInput
  onChange: (value: RecurrenceInput) => void
}) {
  function toggleWeekday(day: number) {
    const current = value.by_weekday ?? []
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    onChange({ ...value, by_weekday: next })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-sm text-text-muted">Every</span>
        <input
          type="number"
          min={1}
          max={999}
          value={value.interval ?? 1}
          onChange={(e) => onChange({ ...value, interval: Number(e.target.value) || 1 })}
          className={clsx(selectClass, 'w-16')}
        />
        <select
          value={value.freq}
          onChange={(e) => onChange({ ...value, freq: e.target.value as RecurrenceFreq })}
          className={selectClass}
        >
          <option value="daily">day(s)</option>
          <option value="weekly">week(s)</option>
          <option value="monthly">month(s)</option>
          <option value="yearly">year(s)</option>
        </select>
      </div>

      {value.freq === 'weekly' && (
        <div className="flex gap-1">
          {WEEKDAY_LABELS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleWeekday(i)}
              className={clsx(
                'h-8 w-10 rounded-md border text-xs transition-colors duration-150',
                (value.by_weekday ?? []).includes(i)
                  ? 'border-accent bg-accent/15 text-text'
                  : 'border-border text-text-muted hover:text-text',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {value.freq === 'monthly' && (
        <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={!value.on_last_day}
              onChange={() => onChange({ ...value, on_last_day: false })}
            />
            On day
            <input
              type="number"
              min={1}
              max={31}
              value={value.by_month_day ?? 1}
              onChange={(e) =>
                onChange({
                  ...value,
                  by_month_day: Number(e.target.value) || 1,
                  on_last_day: false,
                })
              }
              className={clsx(selectClass, 'w-16')}
            />
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={value.on_last_day ?? false}
              onChange={() => onChange({ ...value, on_last_day: true })}
            />
            Last day of month
          </label>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-text-muted">Ends</p>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.end_type === 'never'}
              onChange={() => onChange({ ...value, end_type: 'never' })}
            />
            Never
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.end_type === 'on_date'}
              onChange={() => onChange({ ...value, end_type: 'on_date' })}
            />
            On date
            <input
              type="date"
              value={value.end_date ?? ''}
              onChange={(e) =>
                onChange({ ...value, end_type: 'on_date', end_date: e.target.value })
              }
              className={selectClass}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              checked={value.end_type === 'after_count'}
              onChange={() => onChange({ ...value, end_type: 'after_count' })}
            />
            After
            <input
              type="number"
              min={1}
              value={value.end_count ?? 1}
              onChange={(e) =>
                onChange({
                  ...value,
                  end_type: 'after_count',
                  end_count: Number(e.target.value) || 1,
                })
              }
              className={clsx(selectClass, 'w-16')}
            />
            times
          </label>
        </div>
      </div>
    </div>
  )
}

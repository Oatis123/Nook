import { useState } from 'react'
import { clsx } from 'clsx'
import { Switch } from '@/design/components/Switch'
import {
  DATE_ONLY_PRESETS,
  MAX_OFFSET_MINUTES,
  MAX_REMINDERS,
  TIMED_PRESETS,
  defaultOffsets,
  formatOffset,
  normalizeOffsets,
} from '@/features/tasks/reminderOffsets'

const inputClass =
  'h-7 rounded-md border border-border bg-surface-raised px-2 text-xs outline-none focus-visible:border-accent'

const UNIT_MINUTES = { min: 1, h: 60, d: 24 * 60 } as const
type Unit = keyof typeof UNIT_MINUTES

/** The reminders switch plus, when on, which reminders a task gets: presets to toggle, a
 * custom "N min/h/days before", and a way back to the defaults. Shared by the create and
 * the detail dialogs. `offsets` null = the defaults. */
export function ReminderFields({
  enabled,
  offsets,
  hasDueDate,
  timed,
  recurring,
  onEnabledChange,
  onOffsetsChange,
}: {
  enabled: boolean
  offsets: number[] | null
  hasDueDate: boolean
  timed: boolean
  recurring: boolean
  onEnabledChange: (enabled: boolean) => void
  onOffsetsChange: (offsets: number[] | null) => void
}) {
  const [amount, setAmount] = useState('')
  const [chosenUnit, setUnit] = useState<Unit>('min')
  const unit: Unit = timed ? chosenUnit : 'd'

  const isDefault = offsets === null
  const selected = normalizeOffsets(offsets ?? defaultOffsets({ timed, recurring }), timed)
  const presets = timed ? TIMED_PRESETS : DATE_ONLY_PRESETS
  const chips = normalizeOffsets([...presets, ...selected], timed).reverse()

  function toggle(offset: number) {
    const next = selected.includes(offset)
      ? selected.filter((o) => o !== offset)
      : [...selected, offset]
    if (next.length > MAX_REMINDERS) return
    onOffsetsChange(normalizeOffsets(next, timed))
  }

  function addCustom() {
    const minutes = Math.round(Number(amount) * UNIT_MINUTES[unit])
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > MAX_OFFSET_MINUTES) return
    if (!selected.includes(minutes) && selected.length >= MAX_REMINDERS) return
    onOffsetsChange(normalizeOffsets([...selected, minutes], timed))
    setAmount('')
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 text-sm text-text-muted">
        <Switch checked={enabled} onCheckedChange={onEnabledChange} label="Reminders enabled" />
        Reminders
        {enabled && hasDueDate && isDefault && <span className="text-xs">(default)</span>}
      </label>

      {enabled && !hasDueDate && (
        <p className="text-xs text-text-muted">Set a due date to get reminders.</p>
      )}

      {enabled && hasDueDate && (
        <div className="flex flex-col gap-2 pl-11">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Remind before">
            {chips.map((offset) => {
              const on = selected.includes(offset)
              return (
                <button
                  key={offset}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(offset)}
                  className={clsx(
                    'h-7 rounded-full border px-2.5 text-xs transition-colors duration-150',
                    on
                      ? 'border-accent bg-accent/15 text-text'
                      : 'border-border text-text-muted hover:text-text',
                  )}
                >
                  {formatOffset(offset, timed)}
                </button>
              )
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              aria-label="Custom reminder"
              placeholder="45"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addCustom()
                }
              }}
              className={clsx(inputClass, 'w-16')}
            />
            <select
              aria-label="Custom reminder unit"
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
              className={inputClass}
            >
              {timed && <option value="min">min</option>}
              {timed && <option value="h">hours</option>}
              <option value="d">days</option>
            </select>
            <span>before</span>
            <button
              type="button"
              onClick={addCustom}
              disabled={amount === ''}
              className="h-7 rounded-md border border-border px-2 text-text-muted hover:text-text disabled:opacity-50"
            >
              Add
            </button>
            {!isDefault && (
              <button
                type="button"
                onClick={() => onOffsetsChange(null)}
                className="ml-auto text-text-muted underline-offset-2 hover:text-text hover:underline"
              >
                Reset to default
              </button>
            )}
          </div>
          {!timed && (
            <p className="text-xs text-text-muted">
              Without a time, reminders come at your daily reminder time.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

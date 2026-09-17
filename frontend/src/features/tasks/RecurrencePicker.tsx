import { useState } from 'react'
import { clsx } from 'clsx'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import type { RecurrenceFreq, RecurrenceInput } from '@/lib/types'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const selectClass =
  'h-8 rounded-md border border-border bg-surface-raised px-2 text-sm outline-none focus-visible:border-accent'

const DEFAULT_RECURRENCE: RecurrenceInput = { freq: 'weekly', interval: 1, end_type: 'never' }

export function RecurrencePicker({
  open,
  onOpenChange,
  hasExisting,
  onSave,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Whether the task already has a repeat rule — shows "Remove repeat" and adjusts the
   * dialog's framing, but the form itself always starts fresh: the backend only returns
   * the raw RRULE string, and reverse-parsing it back into these structured fields isn't
   * worth it just to pre-fill a form the user is about to overwrite anyway. */
  hasExisting: boolean
  onSave: (value: RecurrenceInput) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState<RecurrenceInput>(DEFAULT_RECURRENCE)
  const [wasOpen, setWasOpen] = useState(open)

  // Reset the draft whenever the dialog (re)opens — adjusted during render rather than
  // in an effect, matching the pattern used for other reusable edit dialogs in this app.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(DEFAULT_RECURRENCE)
  }

  function toggleWeekday(day: number) {
    const current = draft.by_weekday ?? []
    const next = current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    setDraft({ ...draft, by_weekday: next })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Repeat">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-text-muted">Every</span>
          <input
            type="number"
            min={1}
            max={999}
            value={draft.interval ?? 1}
            onChange={(e) => setDraft({ ...draft, interval: Number(e.target.value) || 1 })}
            className={clsx(selectClass, 'w-16')}
          />
          <select
            value={draft.freq}
            onChange={(e) => setDraft({ ...draft, freq: e.target.value as RecurrenceFreq })}
            className={selectClass}
          >
            <option value="daily">day(s)</option>
            <option value="weekly">week(s)</option>
            <option value="monthly">month(s)</option>
            <option value="yearly">year(s)</option>
          </select>
        </div>

        {draft.freq === 'weekly' && (
          <div className="flex gap-1">
            {WEEKDAY_LABELS.map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={clsx(
                  'h-8 w-10 rounded-md border text-xs transition-colors duration-150',
                  (draft.by_weekday ?? []).includes(i)
                    ? 'border-accent bg-accent/15 text-text'
                    : 'border-border text-text-muted hover:text-text',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {draft.freq === 'monthly' && (
          <div className="flex items-center gap-3 text-sm text-text-muted">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                checked={!draft.on_last_day}
                onChange={() => setDraft({ ...draft, on_last_day: false })}
              />
              On day
              <input
                type="number"
                min={1}
                max={31}
                value={draft.by_month_day ?? 1}
                onChange={(e) =>
                  setDraft({
                    ...draft,
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
                checked={draft.on_last_day ?? false}
                onChange={() => setDraft({ ...draft, on_last_day: true })}
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
                checked={draft.end_type === 'never'}
                onChange={() => setDraft({ ...draft, end_type: 'never' })}
              />
              Never
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={draft.end_type === 'on_date'}
                onChange={() => setDraft({ ...draft, end_type: 'on_date' })}
              />
              On date
              <input
                type="date"
                value={draft.end_date ?? ''}
                onChange={(e) =>
                  setDraft({ ...draft, end_type: 'on_date', end_date: e.target.value })
                }
                className={selectClass}
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={draft.end_type === 'after_count'}
                onChange={() => setDraft({ ...draft, end_type: 'after_count' })}
              />
              After
              <input
                type="number"
                min={1}
                value={draft.end_count ?? 1}
                onChange={(e) =>
                  setDraft({
                    ...draft,
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

        <div
          className={clsx(
            'flex border-t border-border pt-3',
            hasExisting ? 'justify-between' : 'justify-end',
          )}
        >
          {hasExisting && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onRemove()
                onOpenChange(false)
              }}
            >
              Remove repeat
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              onSave(draft)
              onOpenChange(false)
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

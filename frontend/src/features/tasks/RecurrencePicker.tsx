import { useState } from 'react'
import { clsx } from 'clsx'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { DEFAULT_RECURRENCE, RecurrenceFields } from '@/features/tasks/RecurrenceFields'
import type { RecurrenceInput } from '@/lib/types'

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Repeat">
      <div className="flex flex-col gap-4">
        <RecurrenceFields value={draft} onChange={setDraft} />

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

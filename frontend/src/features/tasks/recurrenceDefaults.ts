import type { RecurrenceInput } from '@/lib/types'

export const DEFAULT_RECURRENCE: RecurrenceInput = {
  freq: 'weekly',
  interval: 1,
  end_type: 'never',
}

/** Reminder offsets are minutes before a task's due moment (0 = at the due moment). A
 * task's `reminder_offsets` is null while it uses the defaults, which the backend
 * computes (app/services/reminders.py) — mirrored here only to show them. */

export const MINUTES_PER_DAY = 24 * 60
export const MAX_REMINDERS = 10
export const MAX_OFFSET_MINUTES = 30 * MINUTES_PER_DAY

export const TIMED_PRESETS = [0, 5, 15, 30, 60, 120, 180, 1440, 2880, 10080]
/** A task with a date but no time is reminded at the daily reminder time, so only whole
 * days make sense for it. */
export const DATE_ONLY_PRESETS = [0, 1440, 2880, 10080]

export function defaultOffsets({ timed, recurring }: { timed: boolean; recurring: boolean }) {
  if (!timed) return [MINUTES_PER_DAY]
  return recurring ? [0] : [MINUTES_PER_DAY, 60, 0]
}

/** Largest first: the order the reminders go out in. */
export function normalizeOffsets(offsets: number[], timed: boolean): number[] {
  const rounded = timed
    ? offsets
    : offsets.map((o) => Math.floor(o / MINUTES_PER_DAY) * MINUTES_PER_DAY)
  return [...new Set(rounded)].sort((a, b) => b - a)
}

function unit(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** "15 min", "2 h", "1 h 30 min", "1 day", "1 week" — how long before the due moment. */
export function formatOffset(minutes: number, timed: boolean): string {
  if (minutes === 0) return timed ? 'At due time' : 'On the day'
  if (minutes % (7 * MINUTES_PER_DAY) === 0) return unit(minutes / (7 * MINUTES_PER_DAY), 'week')
  if (minutes % MINUTES_PER_DAY === 0) return unit(minutes / MINUTES_PER_DAY, 'day')
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

import { isYmd, parseLocalDate } from '@/lib/dates'

// Interface language is English-only (spec §0), regardless of the browser/OS locale,
// so every date/time formatter here pins 'en-US' rather than using the default locale.
const LOCALE = 'en-US'

// Made once: toLocaleDateString(locale, options) builds a new formatter on every call,
// which added up in long lists (a due date per task row).
const DATE_FORMAT = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium' })
const DATE_TIME_FORMAT = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatDate(iso: string): string {
  // A bare calendar date (a task's due date) is shown as that date, not converted from
  // UTC midnight into the browser's zone (which moved it a day back west of UTC).
  const date = isYmd(iso) ? parseLocalDate(iso) : new Date(iso)
  return DATE_FORMAT.format(date)
}

export function formatDateTime(iso: string): string {
  return DATE_TIME_FORMAT.format(new Date(iso))
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unitIndex]}`
}

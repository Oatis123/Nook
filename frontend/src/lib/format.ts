// Interface language is English-only (spec §0), regardless of the browser/OS locale,
// so every date/time formatter here pins 'en-US' rather than using the default locale.
const LOCALE = 'en-US'

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { dateStyle: 'medium' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
}

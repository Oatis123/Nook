// Interface language is English-only (spec §0), regardless of the browser/OS locale,
// so every date/time formatter here pins 'en-US' rather than using the default locale.
const LOCALE = 'en-US'

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(LOCALE, { dateStyle: 'medium' })
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' })
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

/** Calendar-date helpers. Task due dates are plain `YYYY-MM-DD` strings in the user's
 * own timezone (the backend computes today/overdue in `user.timezone`), so they must
 * never go through `new Date('YYYY-MM-DD')` — that's UTC midnight, which is the previous
 * day anywhere west of UTC — or `toISOString()`, which is the UTC date. */

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isYmd(value: string): boolean {
  return YMD_RE.test(value)
}

/** `YYYY-MM-DD` → a local Date at midnight of that calendar day (for date-fns etc.). */
export function parseLocalDate(ymd: string): Date {
  const match = YMD_RE.exec(ymd)
  if (!match) return new Date(ymd)
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Today's calendar date in `timeZone` (an IANA name), as `YYYY-MM-DD`. Falls back to
 * the browser's own zone if the name is missing or unknown. */
export function todayIn(timeZone?: string | null, now: Date = new Date()): string {
  const parts = (tz?: string) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
  let resolved
  try {
    resolved = parts(timeZone ?? undefined)
  } catch {
    resolved = parts()
  }
  const get = (type: string) => resolved.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

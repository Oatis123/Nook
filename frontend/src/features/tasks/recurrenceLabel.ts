import type { RecurrenceInput } from '@/lib/types'

const WEEKDAY_NAMES: Record<string, string> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Same style of summary as describeRrule, but straight from the structured input quick
 * add / the picker already has in hand — avoids round-tripping through an RRULE string
 * just to preview it before the task (and its server-built rrule) actually exist. */
export function describeRecurrenceInput(rec: RecurrenceInput): string {
  const interval = rec.interval ?? 1
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rec.freq]
  let label = interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`

  if (rec.freq === 'weekly' && rec.by_weekday && rec.by_weekday.length > 0) {
    label += ` on ${rec.by_weekday.map((d) => WEEKDAY_SHORT[d]).join(', ')}`
  }
  if (rec.freq === 'monthly') {
    if (rec.on_last_day) label += ' on the last day'
    else if (rec.by_month_day) label += ` on day ${rec.by_month_day}`
  }
  if (rec.end_type === 'after_count' && rec.end_count) label += `, ${rec.end_count}×`
  if (rec.end_type === 'on_date' && rec.end_date) label += ` until ${rec.end_date}`

  return label
}

/** Short human-readable summary of an RFC5545 RRULE string, for display only — not a full
 * parser (the picker rebuilds the rule from scratch rather than round-tripping this). */
export function describeRrule(rrule: string): string {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]))
  const freq = parts.FREQ?.toLowerCase() ?? 'daily'
  const interval = Number(parts.INTERVAL ?? '1')
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[freq] ?? freq

  let label = interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`

  if (freq === 'weekly' && parts.BYDAY) {
    const days = parts.BYDAY.split(',')
      .map((d) => WEEKDAY_NAMES[d] ?? d)
      .join(', ')
    label += ` on ${days}`
  }
  if (freq === 'monthly' && parts.BYMONTHDAY) {
    label += parts.BYMONTHDAY === '-1' ? ' on the last day' : ` on day ${parts.BYMONTHDAY}`
  }
  if (parts.COUNT) label += `, ${parts.COUNT}×`
  if (parts.UNTIL)
    label += ` until ${parts.UNTIL.slice(0, 4)}-${parts.UNTIL.slice(4, 6)}-${parts.UNTIL.slice(6, 8)}`

  return label
}

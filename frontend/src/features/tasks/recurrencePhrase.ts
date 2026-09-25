import { addDays, format } from 'date-fns'
import type { RecurrenceFreq, RecurrenceInput } from '@/lib/types'

const FREQ_UNIT: Record<string, RecurrenceFreq> = {
  day: 'daily',
  days: 'daily',
  week: 'weekly',
  weeks: 'weekly',
  month: 'monthly',
  months: 'monthly',
  year: 'yearly',
  years: 'yearly',
}

// Full names first: each day's abbreviations don't share a common "stem + day" suffix
// (Wednesday isn't "wed" + "day"), so the alternatives are spelled out directly rather
// than composed — and the longest form must come first or the regex would match just the
// "wed" prefix of "wednesday" and leave "nesday" dangling, failing the trailing \b.
const WEEKDAY_TOKEN =
  'monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun'
const WEEKDAY_INDEX: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tues: 1,
  tue: 1,
  wednesday: 2,
  weds: 2,
  wed: 2,
  thursday: 3,
  thurs: 3,
  thur: 3,
  thu: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
}

function removeMatch(text: string, match: RegExpExecArray): string {
  const withoutMatch = text.slice(0, match.index) + text.slice(match.index + match[0].length)
  return withoutMatch.replace(/\s+/g, ' ').trim()
}

function extractWeekdays(phrase: string): number[] {
  const re = new RegExp(`\\b(${WEEKDAY_TOKEN})\\b`, 'gi')
  const days = new Set<number>()
  for (const m of phrase.matchAll(re)) days.add(WEEKDAY_INDEX[m[1].toLowerCase()])
  return Array.from(days).sort((a, b) => a - b)
}

/** `every N days/weeks/months/years`, `every weekday`, `every <weekday(s)>`, `every
 * day/week/month/year`, or `daily`/`weekly`/`monthly`/`yearly`/`annually` — the common
 * English recurrence phrases
 * (spec §7.7's "every monday 9am" example). Anything fancier (custom BYMONTHDAY, an end
 * condition, etc.) isn't expressible from quick add text; use the task's Repeat picker for
 * that. Returns null when nothing recurrence-shaped is found. */
export function parseRecurrencePhrase(text: string): {
  recurrence: RecurrenceInput | null
  remaining: string
} {
  const everyN = /\bevery\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)\b/i.exec(text)
  if (everyN) {
    return {
      recurrence: {
        freq: FREQ_UNIT[everyN[2].toLowerCase()],
        interval: parseInt(everyN[1], 10),
        end_type: 'never',
      },
      remaining: removeMatch(text, everyN),
    }
  }

  const everyWeekday = /\bevery\s+weekday\b/i.exec(text)
  if (everyWeekday) {
    return {
      recurrence: { freq: 'weekly', interval: 1, by_weekday: [0, 1, 2, 3, 4], end_type: 'never' },
      remaining: removeMatch(text, everyWeekday),
    }
  }

  const weekdayList = new RegExp(
    `\\bevery\\s+((?:${WEEKDAY_TOKEN})(?:\\s*(?:,|and)\\s*(?:${WEEKDAY_TOKEN}))*)\\b`,
    'i',
  ).exec(text)
  if (weekdayList) {
    const days = extractWeekdays(weekdayList[1])
    if (days.length > 0) {
      return {
        recurrence: { freq: 'weekly', interval: 1, by_weekday: days, end_type: 'never' },
        remaining: removeMatch(text, weekdayList),
      }
    }
  }

  const everyUnit = /\bevery\s+(day|week|month|year)\b/i.exec(text)
  if (everyUnit) {
    return {
      recurrence: { freq: FREQ_UNIT[everyUnit[1].toLowerCase()], interval: 1, end_type: 'never' },
      remaining: removeMatch(text, everyUnit),
    }
  }

  const freqWord = /\b(daily|weekly|monthly|yearly|annually)\b/i.exec(text)
  if (freqWord) {
    const word = freqWord[1].toLowerCase()
    const freq: RecurrenceFreq = word === 'annually' ? 'yearly' : (word as RecurrenceFreq)
    return {
      recurrence: { freq, interval: 1, end_type: 'never' },
      remaining: removeMatch(text, freqWord),
    }
  }

  return { recurrence: null, remaining: text }
}

/** A recurring task needs a first-occurrence date (spec §7.4); when quick add's phrase
 * didn't pin one down itself (chrono found no date, e.g. bare "every monday"), this picks
 * the next matching day for a weekday-list rule, or today for anything else. */
export function computeDefaultRecurrenceStartDate(
  recurrence: RecurrenceInput,
  today: Date = new Date(),
): string {
  if (recurrence.freq === 'weekly' && recurrence.by_weekday && recurrence.by_weekday.length > 0) {
    const isoToday = (today.getDay() + 6) % 7 // JS Sunday=0..Saturday=6 -> Monday=0..Sunday=6
    const sorted = [...recurrence.by_weekday].sort((a, b) => a - b)
    const next = sorted.find((d) => d >= isoToday) ?? sorted[0] + 7
    return format(addDays(today, next - isoToday), 'yyyy-MM-dd')
  }
  return format(today, 'yyyy-MM-dd')
}

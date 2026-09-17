import { describe, expect, it } from 'vitest'
import { parseRecurrencePhrase } from '@/features/tasks/recurrencePhrase'

describe('parseRecurrencePhrase', () => {
  it('parses "every N days/weeks/months/years"', () => {
    expect(parseRecurrencePhrase('every 3 days').recurrence).toEqual({
      freq: 'daily',
      interval: 3,
      end_type: 'never',
    })
    expect(parseRecurrencePhrase('every 2 weeks').recurrence).toEqual({
      freq: 'weekly',
      interval: 2,
      end_type: 'never',
    })
  })

  it('parses a single weekday', () => {
    const { recurrence, remaining } = parseRecurrencePhrase('every monday')
    expect(recurrence).toEqual({ freq: 'weekly', interval: 1, by_weekday: [0], end_type: 'never' })
    expect(remaining).toBe('')
  })

  it('parses a list of weekdays joined by "and"', () => {
    const { recurrence } = parseRecurrencePhrase('every monday and wednesday')
    expect(recurrence?.by_weekday).toEqual([0, 2])
  })

  it('parses a comma-separated list of weekdays', () => {
    const { recurrence } = parseRecurrencePhrase('every mon, wed, fri')
    expect(recurrence?.by_weekday).toEqual([0, 2, 4])
  })

  it('parses "every weekday" as Mon-Fri', () => {
    const { recurrence } = parseRecurrencePhrase('every weekday')
    expect(recurrence).toEqual({
      freq: 'weekly',
      interval: 1,
      by_weekday: [0, 1, 2, 3, 4],
      end_type: 'never',
    })
  })

  it('parses bare "every day/week/month/year"', () => {
    expect(parseRecurrencePhrase('every day').recurrence).toEqual({
      freq: 'daily',
      interval: 1,
      end_type: 'never',
    })
  })

  it('parses "weekly"/"monthly"/"yearly"/"annually"', () => {
    expect(parseRecurrencePhrase('weekly').recurrence?.freq).toBe('weekly')
    expect(parseRecurrencePhrase('monthly').recurrence?.freq).toBe('monthly')
    expect(parseRecurrencePhrase('annually').recurrence?.freq).toBe('yearly')
  })

  it('leaves the rest of the text intact', () => {
    const { recurrence, remaining } = parseRecurrencePhrase('Standup every monday 9am')
    expect(recurrence?.freq).toBe('weekly')
    expect(remaining).toBe('Standup 9am')
  })

  it('returns null recurrence for plain text', () => {
    expect(parseRecurrencePhrase('Buy milk').recurrence).toBeNull()
  })
})

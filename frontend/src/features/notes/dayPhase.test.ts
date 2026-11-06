import { describe, expect, it } from 'vitest'
import { dayPhaseAt } from '@/features/notes/dayPhase'

function at(hour: number, minute = 0): Date {
  return new Date(2026, 10, 6, hour, minute)
}

describe('dayPhaseAt', () => {
  it.each([
    [0, 'night'],
    [4, 'night'],
    [5, 'morning'],
    [10, 'morning'],
    [11, 'day'],
    [16, 'day'],
    [17, 'evening'],
    [21, 'evening'],
    [22, 'night'],
    [23, 'night'],
  ] as const)('%i:00 is %s', (hour, phase) => {
    expect(dayPhaseAt(at(hour))).toBe(phase)
  })

  it('keeps a phase until the next boundary minute', () => {
    expect(dayPhaseAt(at(4, 59))).toBe('night')
    expect(dayPhaseAt(at(10, 59))).toBe('morning')
    expect(dayPhaseAt(at(16, 59))).toBe('day')
    expect(dayPhaseAt(at(21, 59))).toBe('evening')
  })
})

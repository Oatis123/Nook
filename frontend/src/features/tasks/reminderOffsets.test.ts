import { describe, expect, it } from 'vitest'
import { defaultOffsets, formatOffset, normalizeOffsets } from '@/features/tasks/reminderOffsets'
import { normalizeTag } from '@/features/tasks/taskTags'

describe('reminder offsets', () => {
  it('formats how long before the due moment', () => {
    expect(formatOffset(0, true)).toBe('At due time')
    expect(formatOffset(0, false)).toBe('On the day')
    expect(formatOffset(15, true)).toBe('15 min')
    expect(formatOffset(90, true)).toBe('1 h 30 min')
    expect(formatOffset(120, true)).toBe('2 h')
    expect(formatOffset(1440, true)).toBe('1 day')
    expect(formatOffset(2880, true)).toBe('2 days')
    expect(formatOffset(10080, true)).toBe('1 week')
  })

  it('sorts largest first, dedupes, and rounds to days without a time', () => {
    expect(normalizeOffsets([15, 120, 15], true)).toEqual([120, 15])
    expect(normalizeOffsets([15, 120, 2880], false)).toEqual([2880, 0])
  })

  it('mirrors the backend defaults', () => {
    expect(defaultOffsets({ timed: true, recurring: false })).toEqual([1440, 60, 0])
    expect(defaultOffsets({ timed: true, recurring: true })).toEqual([0])
    expect(defaultOffsets({ timed: false, recurring: false })).toEqual([1440])
  })
})

describe('normalizeTag', () => {
  it('accepts note-style tags, with or without #', () => {
    expect(normalizeTag(' #home/repairs ')).toBe('home/repairs')
    expect(normalizeTag('дом')).toBe('дом')
  })

  it('rejects what a note tag can not be', () => {
    expect(normalizeTag('two words')).toBeNull()
    expect(normalizeTag('1abc')).toBeNull()
    expect(normalizeTag('#')).toBeNull()
  })
})

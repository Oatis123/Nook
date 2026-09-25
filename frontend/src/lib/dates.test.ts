import { afterEach, describe, expect, it } from 'vitest'
import { parseLocalDate, todayIn } from '@/lib/dates'
import { formatDate } from '@/lib/format'

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

describe('todayIn', () => {
  // 01:00 on Sep 25 in Vladivostok is still Sep 24 in UTC — the case where the Today
  // view used to show "Nothing due today".
  const instant = new Date('2026-09-24T15:00:00Z')

  it('uses the given timezone, not UTC', () => {
    expect(todayIn('Asia/Vladivostok', instant)).toBe('2026-09-25')
    expect(todayIn('Europe/Moscow', instant)).toBe('2026-09-24')
    expect(todayIn('America/New_York', new Date('2026-09-25T02:00:00Z'))).toBe('2026-09-24')
  })

  it('falls back to the browser zone for an unknown name', () => {
    expect(todayIn('Mars/Base', instant)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('calendar dates west of UTC', () => {
  it('keeps the same day when parsed and formatted', () => {
    process.env.TZ = 'America/New_York'
    const date = parseLocalDate('2026-09-24')
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 24])
    expect(formatDate('2026-09-24')).toBe('Sep 24, 2026')
  })
})

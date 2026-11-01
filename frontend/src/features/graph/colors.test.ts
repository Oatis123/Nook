import { describe, expect, it } from 'vitest'
import { INKS, inkForKey } from '@/features/graph/colors'

describe('inkForKey', () => {
  it('is deterministic for the same key', () => {
    expect(inkForKey('Projects')).toBe(inkForKey('Projects'))
  })

  it('always returns one of the five category inks', () => {
    for (const key of ['Projects', 'Personal', 'Дневник', '', '__root__']) {
      expect(INKS).toContain(inkForKey(key))
    }
  })

  it('spreads keys over the inks', () => {
    const used = new Set(Array.from({ length: 50 }, (_, i) => inkForKey(`folder ${i}`)))
    expect(used.size).toBe(INKS.length)
  })
})

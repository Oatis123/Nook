import { describe, expect, it } from 'vitest'
import { colorForKey } from '@/features/graph/colors'

describe('colorForKey', () => {
  it('is deterministic for the same key', () => {
    expect(colorForKey('Projects')).toBe(colorForKey('Projects'))
  })

  it('differs for different keys (usually)', () => {
    expect(colorForKey('Projects')).not.toBe(colorForKey('Personal'))
  })

  it('always returns a valid hsl() string', () => {
    expect(colorForKey('anything')).toMatch(/^hsl\(\d+, 55%, 55%\)$/)
  })
})

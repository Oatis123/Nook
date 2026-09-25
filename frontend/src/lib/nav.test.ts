import { describe, expect, it } from 'vitest'
import { safeNextPath } from '@/lib/nav'

describe('safeNextPath', () => {
  it.each([
    ['/notes/1?x=2', '/notes/1?x=2'],
    [null, '/'],
    ['', '/'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected)
  })
})

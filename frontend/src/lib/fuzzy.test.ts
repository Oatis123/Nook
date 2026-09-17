import { describe, expect, it } from 'vitest'
import { fuzzyFilter, fuzzyScore } from '@/lib/fuzzy'

describe('fuzzyScore', () => {
  it('matches a subsequence regardless of gaps', () => {
    expect(fuzzyScore('mtg', 'Meeting notes')).not.toBeNull()
  })

  it('returns null when a query character is missing', () => {
    expect(fuzzyScore('xyz', 'Meeting notes')).toBeNull()
  })

  it('ranks a consecutive match higher than a scattered one', () => {
    const consecutive = fuzzyScore('note', 'note taking')
    const scattered = fuzzyScore('note', 'not on plate')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive!).toBeGreaterThan(scattered!)
  })

  it('ranks an earlier match higher than a later one', () => {
    const early = fuzzyScore('cat', 'cat food')
    const late = fuzzyScore('cat', 'the food cat')
    expect(early!).toBeGreaterThan(late!)
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('MTG', 'meeting')).not.toBeNull()
  })
})

describe('fuzzyFilter', () => {
  it('returns all items unfiltered for an empty query', () => {
    const items = ['Alpha', 'Beta', 'Gamma']
    expect(fuzzyFilter('', items, (i) => i)).toEqual(items)
  })

  it('filters out non-matching items and sorts by score', () => {
    const items = ['Weekly meeting', 'Grocery list', 'Team meeting notes']
    const result = fuzzyFilter('meet', items, (i) => i)
    expect(result).toEqual(['Weekly meeting', 'Team meeting notes'])
  })
})

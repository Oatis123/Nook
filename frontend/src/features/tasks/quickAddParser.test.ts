import { describe, expect, it } from 'vitest'
import { parseQuickAdd } from '@/features/tasks/quickAddParser'

describe('parseQuickAdd', () => {
  it('extracts priority and list, leaving the rest as title', () => {
    const result = parseQuickAdd('Call mom !high #Personal')
    expect(result.priority).toBe('high')
    expect(result.listName).toBe('Personal')
    expect(result.title).toBe('Call mom')
  })

  it('parses a date and time with chrono-node', () => {
    const result = parseQuickAdd('Call mom tomorrow 18:00 !high #Personal')
    expect(result.dueDate).not.toBeNull()
    expect(result.dueTime).toBe('18:00:00')
    expect(result.priority).toBe('high')
    expect(result.listName).toBe('Personal')
    expect(result.title).toBe('Call mom')
  })

  it('leaves dueTime null when only a date is given', () => {
    const result = parseQuickAdd('Pay rent tomorrow')
    expect(result.dueDate).not.toBeNull()
    expect(result.dueTime).toBeNull()
  })

  it('returns nulls for plain text with no recognizable tokens', () => {
    const result = parseQuickAdd('Buy milk')
    expect(result.dueDate).toBeNull()
    expect(result.dueTime).toBeNull()
    expect(result.priority).toBeNull()
    expect(result.listName).toBeNull()
    expect(result.title).toBe('Buy milk')
  })

  it('is case-insensitive for priority', () => {
    expect(parseQuickAdd('Task !LOW').priority).toBe('low')
  })
})

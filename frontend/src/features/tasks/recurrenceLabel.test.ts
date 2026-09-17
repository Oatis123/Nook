import { describe, expect, it } from 'vitest'
import { describeRrule } from '@/features/tasks/recurrenceLabel'

describe('describeRrule', () => {
  it('describes a plain daily rule', () => {
    expect(describeRrule('FREQ=DAILY')).toBe('Every day')
  })

  it('describes an interval', () => {
    expect(describeRrule('FREQ=DAILY;INTERVAL=3')).toBe('Every 3 days')
  })

  it('describes weekly with specific days', () => {
    expect(describeRrule('FREQ=WEEKLY;BYDAY=MO,WE,FR')).toBe('Every week on Mon, Wed, Fri')
  })

  it('describes monthly on the last day', () => {
    expect(describeRrule('FREQ=MONTHLY;BYMONTHDAY=-1')).toBe('Every month on the last day')
  })

  it('appends a count when present', () => {
    expect(describeRrule('FREQ=DAILY;COUNT=5')).toBe('Every day, 5×')
  })
})

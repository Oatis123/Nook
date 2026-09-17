import { describe, expect, it } from 'vitest'
import { buildAttachmentIndex } from '@/features/notes/attachmentIndex'
import type { Attachment } from '@/lib/types'

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'id',
    filename: 'file.png',
    mime: 'image/png',
    size: 100,
    created_at: '2026-01-01T00:00:00Z',
    used_by: [],
    ...overrides,
  }
}

describe('buildAttachmentIndex', () => {
  it('resolves a unique filename', () => {
    const index = buildAttachmentIndex([attachment({ id: 'a1', filename: 'diagram.png' })])
    expect(index.resolve('diagram.png')).toEqual({ id: 'a1', mime: 'image/png' })
  })

  it('returns null for an unknown filename', () => {
    const index = buildAttachmentIndex([attachment({ id: 'a1', filename: 'diagram.png' })])
    expect(index.resolve('missing.png')).toBeNull()
  })

  it('returns null when the filename is ambiguous', () => {
    const index = buildAttachmentIndex([
      attachment({ id: 'a1', filename: 'diagram.png' }),
      attachment({ id: 'a2', filename: 'diagram.png' }),
    ])
    expect(index.resolve('diagram.png')).toBeNull()
  })
})

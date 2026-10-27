import { describe, expect, it } from 'vitest'
import { sourceOffsetFor } from '@/features/notes/previewCaret'

describe('sourceOffsetFor', () => {
  const source = '# Title\n\nSome **bold** text and more.\n\n- one\n- two\n'

  it('puts the cursor at the clicked place in the text', () => {
    expect(sourceOffsetFor(source, { text: 'Some ', offset: 2, repeat: 0 })).toBe(
      source.indexOf('Some ') + 2,
    )
    expect(sourceOffsetFor(source, { text: ' text and more.', offset: 6, repeat: 0 })).toBe(
      source.indexOf(' text and more.') + 6,
    )
  })

  it('picks the occurrence matching how many identical texts precede it on the page', () => {
    const repeated = 'same\n\nother\n\nsame\n'
    expect(sourceOffsetFor(repeated, { text: 'same', offset: 1, repeat: 0 })).toBe(1)
    expect(sourceOffsetFor(repeated, { text: 'same', offset: 1, repeat: 1 })).toBe(
      repeated.lastIndexOf('same') + 1,
    )
  })

  it('ignores whitespace the rendering added around the text', () => {
    expect(sourceOffsetFor(source, { text: '\ntwo\n', offset: 3, repeat: 0 })).toBe(
      source.indexOf('two') + 2,
    )
  })

  it('gives up when the text is not in the source', () => {
    expect(sourceOffsetFor(source, { text: 'rendered formula', offset: 0, repeat: 0 })).toBeNull()
  })
})

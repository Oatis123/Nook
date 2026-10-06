import { describe, expect, it } from 'vitest'
import { createPreviewRenderer } from '@/features/notes/previewPipeline'

const context = { theme: 'light' as const, notes: [], folders: [], attachments: [] }

describe('preview blocks', () => {
  it('sends back only the blocks that changed, wherever they moved', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)

    const first = await renderer.render('# Title\n\nOne\n\nTwo\n\nThree', new Set())
    const firstKeys = first.keys.filter((key) => first.blocks[key]?.type === 'element')
    expect(firstKeys).toHaveLength(4)

    // Edit "Two" and add a paragraph above everything: positions shift for every block.
    const second = await renderer.render(
      'New\n\n# Title\n\nOne\n\nTwo edited\n\nThree',
      new Set(first.keys),
    )
    const sent = Object.values(second.blocks).filter((b) => b.type === 'element')
    expect(sent.map((b) => (b.type === 'element' ? b.children : null))).toEqual([
      [{ type: 'text', value: 'New' }],
      [{ type: 'text', value: 'Two edited' }],
    ])
    // The untouched blocks keep their keys, so the preview reuses them as they are.
    expect(second.keys).toEqual(expect.arrayContaining([firstKeys[0], firstKeys[1], firstKeys[3]]))
  })

  it('renders notes without code without loading the highlighter', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('Plain *text* and `inline code`', new Set())
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('"tagName":"code"')
    expect(html).not.toContain('"style"')
  })
})

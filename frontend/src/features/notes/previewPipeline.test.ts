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

  it('renders formulas with KaTeX, inline and display, next to highlighted code', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render(
      String.raw`Euler: $e^{i\pi} + 1 = 0$` +
        '\n\n$$\n' +
        String.raw`\int_0^1 x^2\,dx = \frac{1}{3}` +
        '\n$$\n\n```js\nlet a = 1\n```',
      new Set(),
    )
    expect(result.math).toBe(true)
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('"katex"')
    expect(html).toContain('"math-display"')
    expect(html).toContain('"katex-display"')
    // The display formula isn't taken for a code block by the highlighter…
    expect(html).not.toContain('int_0^1 x^2')
    // …while the real one is still highlighted.
    expect(html).toMatch(/"style":"color:#[0-9A-Fa-f]{6}"/)
  })

  it('keeps dollar amounts as text', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('It cost $5 and $10, or $ 3 $ more', new Set())
    expect(result.math).toBe(false)
    const html = JSON.stringify(result.blocks)
    expect(html).not.toContain('katex')
    expect(html).toContain('$5 and $')
    expect(html).toContain('$ 3 $')
  })

  it('shows a broken formula as its source instead of failing the note', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render(String.raw`Oops: $\frac{1}{$ and fine`, new Set())
    const html = JSON.stringify(result.blocks)
    expect(html).toContain('katex-error')
    expect(html).toContain('and fine')
  })

  it('wraps task items so a done one can be struck through without its sub-list', async () => {
    const renderer = createPreviewRenderer()
    renderer.setContext(context)
    const result = await renderer.render('- [x] Done\n  - [ ] Nested\n- [ ] Open', new Set())
    const list = Object.values(result.blocks).find(
      (block) => block.type === 'element' && block.tagName === 'ul',
    )
    const items = JSON.parse(JSON.stringify(list)).children.filter(
      (child: { tagName?: string }) => child.tagName === 'li',
    )
    expect(items[0].properties.className).toEqual(['task-list-item', 'task-list-item-checked'])
    expect(items[1].properties.className).toEqual(['task-list-item'])
    const label = items[0].children.find((child: { tagName?: string }) => child.tagName === 'span')
    expect(label.properties.className).toEqual(['task-list-label'])
    expect(label.children).toEqual([{ type: 'text', value: 'Done' }])
    // The nested list stays outside the label.
    expect(items[0].children.some((child: { tagName?: string }) => child.tagName === 'ul')).toBe(
      true,
    )
  })
})

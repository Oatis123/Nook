import { visit } from 'unist-util-visit'
import type { Root, Blockquote, Paragraph, Text } from 'mdast'

const CALLOUT_RE = /^\[!(\w+)\]\s*(.*)$/

/** Obsidian-style callouts: `> [!note]` / `> [!warning] Custom title` (spec §6.3,
 * marked "desirable"). Adds a `callout callout-<type>` class + a `data-callout-type`
 * attribute to the blockquote (styled in index.css, label shown via CSS content) and
 * strips the `[!type]` marker from the visible text. Only the first *line* of the first
 * text node is checked — the rest of a multi-line blockquote (soft-wrapped into the same
 * text node, e.g. "[!warning] Title\nBody...") is left as the callout's body. */
export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, 'blockquote', (node: Blockquote) => {
      const firstChild = node.children[0]
      if (!firstChild || firstChild.type !== 'paragraph') return
      const firstText = (firstChild as Paragraph).children[0]
      if (!firstText || firstText.type !== 'text') return

      const value = (firstText as Text).value
      const newlineIndex = value.indexOf('\n')
      const firstLine = newlineIndex === -1 ? value : value.slice(0, newlineIndex)
      const rest = newlineIndex === -1 ? '' : value.slice(newlineIndex)

      const match = CALLOUT_RE.exec(firstLine)
      if (!match) return

      const [, rawType, title] = match
      const type = rawType.toLowerCase()

      const data = (node.data ??= {}) as Record<string, unknown>
      data.hProperties = {
        ...(data.hProperties as Record<string, unknown> | undefined),
        className: ['callout', `callout-${type}`],
        'data-callout-type': type,
      }

      ;(firstText as Text).value = title.trim() + rest
    })
  }
}

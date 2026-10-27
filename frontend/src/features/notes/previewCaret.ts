/** Where in the preview's text a click landed, so the editor can put its cursor at the same
 * place in the Markdown: the rendered text is the source minus its syntax, so the text node
 * that was clicked is searched for in the source. */
export interface CaretHint {
  /** The clicked text node's text. */
  text: string
  /** The click's offset within `text`. */
  offset: number
  /** How many text nodes with the very same text come before it in the preview — the
   * source's same-numbered occurrence is the one meant. */
  repeat: number
}

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  if (document.caretPositionFromPoint) {
    const position = document.caretPositionFromPoint(x, y)
    return position ? { node: position.offsetNode, offset: position.offset } : null
  }
  // Chromium and Safari have only the older, range-based form.
  const range = document.caretRangeFromPoint?.(x, y)
  return range ? { node: range.startContainer, offset: range.startOffset } : null
}

export function caretHintAt(container: HTMLElement, x: number, y: number): CaretHint | null {
  const caret = caretAt(x, y)
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE || !container.contains(caret.node)) {
    return null
  }
  const text = caret.node.nodeValue ?? ''
  if (!text.trim()) return null
  let repeat = 0
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node && node !== caret.node; node = walker.nextNode()) {
    if (node.nodeValue === text) repeat += 1
  }
  return { text, offset: caret.offset, repeat }
}

function nthIndexOf(source: string, needle: string, n: number): number {
  let found = -1
  let from = 0
  for (let i = 0; i <= n; i += 1) {
    const at = source.indexOf(needle, from)
    if (at === -1) break
    found = at
    from = at + 1
  }
  return found
}

/** The cursor position in `source` for a click, or null if the clicked text can't be found
 * there (it came from a formula, an embed, an escaped character…). */
export function sourceOffsetFor(source: string, hint: CaretHint): number | null {
  const lead = hint.text.length - hint.text.trimStart().length
  for (const [needle, skipped] of [
    [hint.text, 0],
    [hint.text.trim(), lead],
  ] as const) {
    const at = nthIndexOf(source, needle, hint.repeat)
    if (at !== -1) return Math.min(source.length, at + Math.max(0, hint.offset - skipped))
  }
  return null
}

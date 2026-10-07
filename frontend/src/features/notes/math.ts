/** LaTeX → HTML tree with KaTeX, for the note preview. Loaded only for notes that have
 * math (previewPipeline.ts), in the preview's worker: hast-util-from-html parses
 * KaTeX's markup without a DOM. */
import type { ElementContent } from 'hast'
import { fromHtml } from 'hast-util-from-html'
import katex from 'katex'

const MAX_CACHED = 500
// Every render re-renders every formula; KaTeX plus the parse is the costly part.
const cache = new Map<string, ElementContent[]>()

export function renderMath(tex: string, displayMode: boolean): ElementContent[] {
  const key = `${displayMode ? 'D' : 'I'}${tex}`
  const cached = cache.get(key)
  if (cached) return structuredClone(cached)
  // throwOnError: false shows a bad formula as red source text instead of failing the
  // whole note; trust stays off, so \href, \includegraphics and the like are refused.
  const html = katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    output: 'html',
    strict: 'ignore',
  })
  const nodes = fromHtml(html, { fragment: true }).children as ElementContent[]
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string)
  cache.set(key, nodes)
  return structuredClone(nodes)
}

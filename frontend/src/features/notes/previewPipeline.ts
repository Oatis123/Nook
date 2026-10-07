/** The note preview's Markdown → HTML-tree pipeline, without React: it runs in a Web
 * Worker (preview.worker.ts), so parsing and highlighting a long note never blocks
 * typing, or on the main thread where workers aren't available (previewClient.ts). */
import type { Element, ElementContent, Root as HastRoot, RootContent as HastContent } from 'hast'
import type { Root as MdastRoot } from 'mdast'
import { unified, type Processor } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import type { HighlighterCore } from 'shiki/core'
import { SKIP, visit } from 'unist-util-visit'
import { getHighlighter, loadLanguages } from '@/features/notes/shiki'
import { remarkWikilinks } from '@/features/notes/remarkWikilinks'
import { remarkCallouts } from '@/features/notes/remarkCallouts'
import { buildWikilinkIndex } from '@/features/notes/wikilinkIndex'
import { buildAttachmentIndex } from '@/features/notes/attachmentIndex'
import type { Attachment, Folder } from '@/lib/types'
import type { NoteLinkTarget } from '@/features/notes/hooks'

type AttrEntry = string | [string, ...unknown[]]

/** The default schema's `className` entries are value-restricted tuples (e.g. only
 * `data-footnote-backref` is allowed) — appending a bare `'className'` alongside that
 * doesn't override it, so any other class value we need still gets stripped. This drops
 * the existing className restriction(s) for a tag before adding our own permissive one. */
function allowAnyClassName(entries: AttrEntry[] | undefined): AttrEntry[] {
  return (entries ?? []).filter(
    (entry) => !(entry === 'className' || (Array.isArray(entry) && entry[0] === 'className')),
  )
}

// Shiki injects inline `style` (per-token colors) and a `class` on <pre>/<code>; wikilinks
// need `data-*` + `className` on <a>/<span>/<blockquote>. The default sanitize schema
// strips (or over-restricts) all of that, so it's extended just enough to keep both.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...allowAnyClassName(defaultSchema.attributes?.span), 'style', 'className'],
    code: [...allowAnyClassName(defaultSchema.attributes?.code), 'style', 'className'],
    pre: [...allowAnyClassName(defaultSchema.attributes?.pre), 'style', 'className'],
    blockquote: [
      ...allowAnyClassName(defaultSchema.attributes?.blockquote),
      'className',
      'data-callout-type',
    ],
    a: [
      ...allowAnyClassName(defaultSchema.attributes?.a),
      'className',
      'title',
      'target',
      'rel',
      'data-wikilink',
      'data-wikilink-target',
      'data-wikilink-heading',
    ],
    img: [...allowAnyClassName(defaultSchema.attributes?.img), 'className', 'src', 'alt'],
  },
}

/** Small LRU map: typing inside a code block makes a new cache key per keystroke, so the
 * cache has to forget old entries. */
class LruCache<V> {
  private readonly map = new Map<string, V>()
  private readonly max: number

  constructor(max: number) {
    this.max = max
  }

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value !== undefined) {
      this.map.delete(key)
      this.map.set(key, value)
    }
    return value
  }

  set(key: string, value: V): this {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
    return this
  }
}

/** Highlighted code blocks, so a re-render only re-highlights the block being edited —
 * Shiki was most of the cost of each render. One per theme: Shiki's cache key is just
 * language + code. Cached fragments are safe to reuse because rehype-sanitize builds a
 * new tree rather than mutating them. */
const highlightCaches = {
  light: new LruCache<HastRoot>(300),
  dark: new LruCache<HastRoot>(300),
}

/** What a render depends on besides the text: plain data, so it can be posted to the
 * worker (the lookup indexes are rebuilt from it there). */
export interface PreviewContext {
  theme: 'light' | 'dark'
  notes: NoteLinkTarget[]
  folders: Pick<Folder, 'id' | 'name'>[]
  attachments: Pick<Attachment, 'id' | 'filename' | 'mime'>[]
}

/** A rendered note as its top-level blocks: `keys` in document order, and the trees of
 * the blocks the caller doesn't already have. A block's key is derived from its content
 * (not its position), so after an edit only the edited blocks come back new and the rest
 * are reused as they are. */
export interface PreviewBlocks {
  keys: string[]
  blocks: Record<string, HastContent>
  /** The note has formulas: the page needs KaTeX's stylesheet. */
  math: boolean
}

export class HighlighterUnavailableError extends Error {}

type RenderMath = (tex: string, displayMode: boolean) => ElementContent[]

function hasClass(node: Element, name: string): boolean {
  const className = node.properties.className
  return Array.isArray(className) && className.includes(name)
}

/** remark-math writes display math as `<pre><code class="math-display">` — which Shiki
 * would take for a code block. Unwrapped before it runs; formulas are rendered after
 * sanitizing (rehypeMath). */
function rehypeUnwrapDisplayMath() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index === undefined) return
      const code = node.children.find((child) => child.type === 'element')
      if (code?.type === 'element' && hasClass(code, 'math-display')) {
        parent.children[index] = code
        return SKIP
      }
    })
  }
}

/** Formulas through KaTeX. After sanitizing, as KaTeX's markup (inline styles, SVG
 * strokes for roots and arrows) is beyond the schema — and needn't pass it: KaTeX escapes
 * what it's given and, with `trust` off, emits no links or images. */
function rehypeMath(render: RenderMath) {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'code' || !parent || index === undefined) return
      const display = hasClass(node, 'math-display')
      if (!display && !hasClass(node, 'math-inline')) return
      const tex = node.children.map((child) => (child.type === 'text' ? child.value : '')).join('')
      const rendered = render(tex, display)
      const replacement: ElementContent[] = display
        ? [
            {
              type: 'element',
              tagName: 'div',
              properties: { className: ['math-display'] },
              children: rendered,
            },
          ]
        : rendered
      ;(parent.children as ElementContent[]).splice(index, 1, ...replacement)
      return [SKIP, index + replacement.length]
    })
  }
}

/** GFM task items: the text after the checkbox goes in a `.task-list-label` (so a done
 * item can be struck through without striking its sub-list), and done items get
 * `.task-list-item-checked`. After sanitizing: these classes are ours, not the note's. */
function rehypeTaskItems() {
  return (tree: HastRoot) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'li' || !hasClass(node, 'task-list-item')) return
      // A loose list wraps the item's text, checkbox included, in a <p>.
      const first = node.children.find((child) => child.type === 'element')
      const holder = first?.type === 'element' && first.tagName === 'p' ? first : node
      const at = holder.children.findIndex(
        (child) => child.type === 'element' && child.tagName === 'input',
      )
      if (at === -1) return
      const input = holder.children[at] as Element
      if (input.properties.checked) {
        node.properties.className = [
          ...(node.properties.className as string[]),
          'task-list-item-checked',
        ]
      }
      let end = at + 1
      while (end < holder.children.length) {
        const child = holder.children[end]
        if (child.type === 'element' && (child.tagName === 'ul' || child.tagName === 'ol')) break
        end += 1
      }
      const label = holder.children.slice(at + 1, end)
      // The space after the box (its gap is CSS's) and the newline before a sub-list.
      const lead = label[0]
      if (lead?.type === 'text') label[0] = { ...lead, value: lead.value.trimStart() }
      const last = label[label.length - 1]
      if (last?.type === 'text') label[label.length - 1] = { ...last, value: last.value.trimEnd() }
      const trimmed = label.filter((child) => child.type !== 'text' || child.value !== '')
      label.splice(0, label.length, ...trimmed)
      holder.children.splice(at + 1, end - at - 1, {
        type: 'element',
        tagName: 'span',
        properties: { className: ['task-list-label'] },
        children: label,
      })
    })
  }
}

/** Notes with formulas also get dollar amounts wrong: "$5 and $10" parses as the formula
 * "5 and ". Like Pandoc and Obsidian, `$…$` is math only if it doesn't start or end with a
 * space and isn't followed by a digit; anything else goes back to being plain text. */
function dropDollarAmounts(tree: MdastRoot, source: string): void {
  visit(tree, 'inlineMath', (node, index, parent) => {
    const start = node.position?.start.offset
    const end = node.position?.end.offset
    if (!parent || index === undefined || start === undefined || end === undefined) return
    const raw = source.slice(start, end)
    const single = raw.startsWith('$') && !raw.startsWith('$$')
    // The source, not node.value: the parser drops a space at either end ("$ 3 $" → "3").
    const inner = raw.slice(1, -1)
    if (single && (/^\s|\s$/.test(inner) || /\d/.test(source[end] ?? ''))) {
      parent.children[index] = { type: 'text', value: raw }
    }
  })
}

/** Which costly parts the note needs: Shiki for fenced code, KaTeX for formulas. */
function needs(tree: MdastRoot): { languages: Set<string>; math: boolean } {
  const languages = new Set<string>()
  let math = false
  visit(tree, (node) => {
    if (node.type === 'code' && node.lang) languages.add(node.lang)
    if (node.type === 'math' || node.type === 'inlineMath') math = true
  })
  return { languages, math }
}

/** Without a highlighter, the pipeline for notes with no fenced code in a language —
 * Shiki only ever touches those blocks, so its WebAssembly engine and grammars aren't
 * fetched at all for them; likewise KaTeX for notes without formulas. */
function buildProcessor(
  context: PreviewContext,
  highlighter: HighlighterCore | null,
  renderMath: RenderMath | null,
): Processor {
  const wikilinkIndex = buildWikilinkIndex(context.notes, context.folders as Folder[])
  const attachmentIndex = buildAttachmentIndex(context.attachments as Attachment[])
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkWikilinks, wikilinkIndex, attachmentIndex)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(renderMath ? [rehypeUnwrapDisplayMath] : [])
    .use(
      highlighter
        ? [
            [
              rehypeShikiFromHighlighter,
              highlighter,
              {
                theme: context.theme === 'dark' ? 'github-dark' : 'github-light',
                fallbackLanguage: 'text',
                cache: highlightCaches[context.theme],
              },
            ],
          ]
        : [],
    )
    .use(rehypeSanitize, sanitizeSchema)
    .use(renderMath ? [[rehypeMath, renderMath]] : [])
    .use(rehypeTaskItems) as unknown as Processor
}

let mathModule: Promise<RenderMath | null> | null = null

/** KaTeX, loaded once. If it can't be (offline, a failed deploy), formulas stay as their
 * source text, and the next note with math tries again. */
function loadMath(): Promise<RenderMath | null> {
  mathModule ??= import('@/features/notes/math').then(
    (module) => module.renderMath,
    () => {
      mathModule = null
      return null
    },
  )
  return mathModule
}

/** Source positions shift with every edit above a block but never change its output, so
 * they're left out of its key (and of what's posted back). */
function withoutPositions(key: string, value: unknown): unknown {
  return key === 'position' ? undefined : value
}

/** Keys are short ids for block contents. Bounded: once full it starts over, which only
 * means the next render sends every block again. */
const MAX_BLOCK_IDS = 20_000
let blockIds = new Map<string, string>()
let nextBlockId = 0

function blockKey(serialized: string): string {
  let id = blockIds.get(serialized)
  if (id === undefined) {
    if (blockIds.size >= MAX_BLOCK_IDS) blockIds = new Map()
    id = `b${(nextBlockId++).toString(36)}`
    blockIds.set(serialized, id)
  }
  return id
}

export function createPreviewRenderer() {
  let context: PreviewContext | null = null
  // By which of Shiki and KaTeX they use; rebuilt when the context changes.
  let processors = new Map<string, Processor>()

  return {
    setContext(next: PreviewContext) {
      context = next
      processors = new Map()
    },

    /** `have`: block keys the caller already holds — those aren't sent again. */
    async render(content: string, have: ReadonlySet<string>): Promise<PreviewBlocks> {
      if (!context) throw new Error('Preview context not set')
      const current = processors
      const processorFor = (h: HighlighterCore | null, m: RenderMath | null) => {
        const key = `${h ? 'h' : ''}${m ? 'm' : ''}`
        let processor = current.get(key)
        if (!processor) {
          processor = buildProcessor(context!, h, m)
          current.set(key, processor)
        }
        return processor
      }
      const mdast = processorFor(null, null).parse(content) as MdastRoot
      dropDollarAmounts(mdast, content)
      const { languages, math } = needs(mdast)
      let highlighter: HighlighterCore | null = null
      if (languages.size > 0) {
        try {
          highlighter = await getHighlighter()
        } catch {
          throw new HighlighterUnavailableError()
        }
        await loadLanguages(highlighter, languages)
      }
      const renderMath = math ? await loadMath() : null
      const hast = (await processorFor(highlighter, renderMath).run(mdast)) as HastRoot

      const keys: string[] = []
      const blocks: Record<string, HastContent> = {}
      for (const child of hast.children) {
        const serialized = JSON.stringify(child, withoutPositions)
        const key = blockKey(serialized)
        keys.push(key)
        if (!have.has(key) && !(key in blocks)) blocks[key] = JSON.parse(serialized) as HastContent
      }
      return { keys, blocks, math: renderMath !== null }
    },
  }
}

/** The note preview's Markdown → HTML-tree pipeline, without React: it runs in a Web
 * Worker (preview.worker.ts), so parsing and highlighting a long note never blocks
 * typing, or on the main thread where workers aren't available (previewClient.ts). */
import type { Root as HastRoot, RootContent as HastContent } from 'hast'
import type { Root as MdastRoot } from 'mdast'
import { unified, type Processor } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import type { HighlighterCore } from 'shiki/core'
import { visit } from 'unist-util-visit'
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
}

export class HighlighterUnavailableError extends Error {}

/** Without a highlighter, the pipeline for notes with no fenced code in a language —
 * Shiki only ever touches those blocks, so its WebAssembly engine and grammars aren't
 * fetched at all for them. */
function buildProcessor(context: PreviewContext, highlighter: HighlighterCore | null): Processor {
  const wikilinkIndex = buildWikilinkIndex(context.notes, context.folders as Folder[])
  const attachmentIndex = buildAttachmentIndex(context.attachments as Attachment[])
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikilinks, wikilinkIndex, attachmentIndex)
    .use(remarkCallouts)
    .use(remarkRehype)
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
    .use(rehypeSanitize, sanitizeSchema) as unknown as Processor
}

/** The languages of the note's fenced code blocks (```js) — the ones Shiki highlights. */
function codeLanguages(tree: MdastRoot): Set<string> {
  const languages = new Set<string>()
  visit(tree, 'code', (node) => {
    if (node.lang) languages.add(node.lang)
  })
  return languages
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
  let processors: { plain: Processor; highlighting: Processor | null } | null = null

  return {
    setContext(next: PreviewContext) {
      context = next
      processors = null
    },

    /** `have`: block keys the caller already holds — those aren't sent again. */
    async render(content: string, have: ReadonlySet<string>): Promise<PreviewBlocks> {
      if (!context) throw new Error('Preview context not set')
      processors ??= { plain: buildProcessor(context, null), highlighting: null }
      const current = processors
      const mdast = current.plain.parse(content) as MdastRoot
      const languages = codeLanguages(mdast)
      let processor = current.plain
      if (languages.size > 0) {
        let highlighter: HighlighterCore
        try {
          highlighter = await getHighlighter()
        } catch {
          throw new HighlighterUnavailableError()
        }
        await loadLanguages(highlighter, languages)
        current.highlighting ??= buildProcessor(context, highlighter)
        processor = current.highlighting
      }
      const hast = (await processor.run(mdast)) as HastRoot

      const keys: string[] = []
      const blocks: Record<string, HastContent> = {}
      for (const child of hast.children) {
        const serialized = JSON.stringify(child, withoutPositions)
        const key = blockKey(serialized)
        keys.push(key)
        if (!have.has(key) && !(key in blocks)) blocks[key] = JSON.parse(serialized) as HastContent
      }
      return { keys, blocks }
    },
  }
}

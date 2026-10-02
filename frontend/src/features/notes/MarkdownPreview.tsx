import {
  type ImgHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { Root as HastRoot } from 'hast'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { unified, type Processor } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeReact from 'rehype-react'
import rehypeShikiFromHighlighter from '@shikijs/rehype/core'
import type { HighlighterCore } from 'shiki/core'
import { useResolvedTheme } from '@/lib/theme'
import { getHighlighter } from '@/features/notes/shiki'
import { remarkWikilinks } from '@/features/notes/remarkWikilinks'
import { remarkCallouts } from '@/features/notes/remarkCallouts'
import { useFolders, useCreateNote, useNoteLinkTargets } from '@/features/notes/hooks'
import { buildWikilinkIndex } from '@/features/notes/wikilinkIndex'
import { buildAttachmentIndex } from '@/features/notes/attachmentIndex'
import { useAttachments } from '@/features/attachments/hooks'

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

/** While typing, the preview re-renders this long after the last change rather than on
 * every keystroke: a long note's render blocks the main thread, which made typing stutter. */
const PREVIEW_DEBOUNCE_MS = 200

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

function buildProcessor(
  highlighter: HighlighterCore,
  theme: 'light' | 'dark',
  wikilinkIndex: ReturnType<typeof buildWikilinkIndex>,
  attachmentIndex: ReturnType<typeof buildAttachmentIndex>,
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikilinks, wikilinkIndex, attachmentIndex)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(rehypeShikiFromHighlighter, highlighter, {
      theme: theme === 'dark' ? 'github-dark' : 'github-light',
      fallbackLanguage: 'text',
      cache: highlightCaches[theme],
    })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeReact, { Fragment, jsx, jsxs, components: { img: PreviewImage } })
}

function isExternalUrl(src: string): boolean {
  if (!/^https?:/i.test(src)) return false
  try {
    return new URL(src).origin !== window.location.origin
  } catch {
    return false
  }
}

/** The CSP only allows images from this site (a remote image would otherwise leak the
 * reader's IP to whoever hosts it), so an external image in a note can't load — show a
 * link to it instead of a broken image. */
function PreviewImage(props: ImgHTMLAttributes<HTMLImageElement>) {
  const src = typeof props.src === 'string' ? props.src : ''
  if (!isExternalUrl(src)) return <img {...props} />
  return (
    <a href={src} target="_blank" rel="noreferrer noopener" className="external-image">
      {props.alt || 'External image'} (opens in a new tab)
    </a>
  )
}

export function MarkdownPreview({ content }: { content: string }) {
  const resolvedTheme = useResolvedTheme()
  const navigate = useNavigate()
  const linkTargets = useNoteLinkTargets()
  const foldersQuery = useFolders()
  const attachmentsQuery = useAttachments()
  const createNote = useCreateNote()
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null)
  const [highlighterError, setHighlighterError] = useState(false)
  const [highlighterAttempt, setHighlighterAttempt] = useState(0)
  const [tree, setTree] = useState<ReactNode>(null)

  useEffect(() => {
    let cancelled = false
    getHighlighter()
      .then((h) => {
        if (!cancelled) setHighlighter(h)
      })
      .catch(() => {
        if (!cancelled) setHighlighterError(true)
      })
    return () => {
      cancelled = true
    }
  }, [highlighterAttempt])

  const wikilinkIndex = useMemo(
    () => buildWikilinkIndex(linkTargets, foldersQuery.data ?? []),
    [linkTargets, foldersQuery.data],
  )

  const attachmentIndex = useMemo(
    () => buildAttachmentIndex(attachmentsQuery.data ?? []),
    [attachmentsQuery.data],
  )

  const processor = useMemo(
    () =>
      highlighter
        ? buildProcessor(highlighter, resolvedTheme, wikilinkIndex, attachmentIndex)
        : null,
    [highlighter, resolvedTheme, wikilinkIndex, attachmentIndex],
  )

  // The first render of a note shows at once; after that, edits re-render once typing pauses.
  const renderedRef = useRef(false)
  useEffect(() => {
    if (!processor) return
    let cancelled = false
    const render = () =>
      (processor as Processor)
        .process(content)
        .then((file: Awaited<ReturnType<Processor['process']>>) => {
          if (cancelled) return
          renderedRef.current = true
          setTree(file.result as ReactNode)
        })
        .catch(() => {
          if (!cancelled) setTree(<p className="text-danger">Couldn't render this note.</p>)
        })
    const timer = setTimeout(render, renderedRef.current ? PREVIEW_DEBOUNCE_MS : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [content, processor])

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-wikilink]')
    if (!link) return
    e.preventDefault()

    if (link.classList.contains('wikilink-dangling')) {
      const title = link.dataset.wikilinkTarget
      if (!title) return
      createNote.mutate(
        { title, folder_id: null },
        { onSuccess: (note) => navigate(`/notes/${note.id}`) },
      )
      return
    }
    if (link.getAttribute('href')) {
      navigate(link.getAttribute('href')!)
    }
  }

  if (highlighterError) {
    return (
      <div className="markdown-preview" onClick={handleClick}>
        <p className="text-danger">Couldn't load the preview.</p>
        <button
          type="button"
          className="text-sm text-accent underline"
          onClick={() => {
            setHighlighterError(false)
            setHighlighterAttempt((n) => n + 1)
          }}
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="markdown-preview" onClick={handleClick}>
      {tree ?? <p className="text-sm text-text-muted">Loading preview…</p>}
    </div>
  )
}

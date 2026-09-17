import { type MouseEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { useFolders, useCreateNote, useNotes } from '@/features/notes/hooks'
import { buildWikilinkIndex } from '@/features/notes/wikilinkIndex'

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
      'data-wikilink',
      'data-wikilink-target',
      'data-wikilink-heading',
    ],
  },
}

function buildProcessor(
  highlighter: HighlighterCore,
  theme: 'light' | 'dark',
  wikilinkIndex: ReturnType<typeof buildWikilinkIndex>,
) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkWikilinks, wikilinkIndex)
    .use(remarkCallouts)
    .use(remarkRehype)
    .use(rehypeShikiFromHighlighter, highlighter, {
      theme: theme === 'dark' ? 'github-dark' : 'github-light',
      fallbackLanguage: 'text',
    })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeReact, { Fragment, jsx, jsxs })
}

export function MarkdownPreview({ content }: { content: string }) {
  const resolvedTheme = useResolvedTheme()
  const navigate = useNavigate()
  const notesQuery = useNotes()
  const foldersQuery = useFolders()
  const createNote = useCreateNote()
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null)
  const [tree, setTree] = useState<ReactNode>(null)

  useEffect(() => {
    let cancelled = false
    getHighlighter().then((h) => {
      if (!cancelled) setHighlighter(h)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const wikilinkIndex = useMemo(
    () => buildWikilinkIndex(notesQuery.data ?? [], foldersQuery.data ?? []),
    [notesQuery.data, foldersQuery.data],
  )

  const processor = useMemo(
    () => (highlighter ? buildProcessor(highlighter, resolvedTheme, wikilinkIndex) : null),
    [highlighter, resolvedTheme, wikilinkIndex],
  )

  useEffect(() => {
    if (!processor) return
    let cancelled = false
    ;(processor as Processor)
      .process(content)
      .then((file: Awaited<ReturnType<Processor['process']>>) => {
        if (!cancelled) setTree(file.result as ReactNode)
      })
      .catch(() => {
        if (!cancelled) setTree(<p className="text-danger">Couldn't render this note.</p>)
      })
    return () => {
      cancelled = true
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

  return (
    <div className="markdown-preview" onClick={handleClick}>
      {tree}
    </div>
  )
}

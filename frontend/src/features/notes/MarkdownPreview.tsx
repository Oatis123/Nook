import { type ReactNode, useEffect, useMemo, useState } from 'react'
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

// Shiki injects inline `style` (per-token colors) and a `class` on <pre>/<code>; the
// default sanitize schema strips both, so extend it just enough to keep highlighting.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span ?? []), 'style'],
    code: [...(defaultSchema.attributes?.code ?? []), 'style', 'className'],
    pre: [...(defaultSchema.attributes?.pre ?? []), 'style', 'className'],
  },
}

function buildProcessor(highlighter: HighlighterCore, theme: 'light' | 'dark') {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
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

  const processor = useMemo(
    () => (highlighter ? buildProcessor(highlighter, resolvedTheme) : null),
    [highlighter, resolvedTheme],
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

  return <div className="markdown-preview">{tree}</div>
}

import {
  memo,
  startTransition,
  type ImgHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { Root as HastRoot, RootContent as HastContent } from 'hast'
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'
import { unified, type Processor } from 'unified'
import rehypeReact from 'rehype-react'
import { useResolvedTheme } from '@/lib/theme'
import { useFolders, useCreateNote, useNoteLinkTargets } from '@/features/notes/hooks'
import { useAttachments } from '@/features/attachments/hooks'
import { createPreviewSession } from '@/features/notes/previewClient'
import type { PreviewContext } from '@/features/notes/previewPipeline'

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

const toReact = unified().use(rehypeReact, {
  Fragment,
  jsx,
  jsxs,
  components: { img: PreviewImage },
}) as unknown as Processor

/** One top-level block of the note. An unchanged block comes back as the very same object,
 * so React skips it; a new one is converted here, inside the render — which a transition
 * can split up, so a long note doesn't hold the page in one long task. */
const PreviewBlock = memo(function PreviewBlock({ block }: { block: HastContent }) {
  const root: HastRoot = { type: 'root', children: [block] }
  return toReact.stringify(root) as ReactNode
})

/** Renders `content` as soon as it changes: while typing, it's given the text only once
 * typing pauses (useNoteAutosave's SETTLE_MS). */
export const MarkdownPreview = memo(function MarkdownPreview({ content }: { content: string }) {
  const resolvedTheme = useResolvedTheme()
  const navigate = useNavigate()
  const linkTargets = useNoteLinkTargets()
  const foldersQuery = useFolders()
  const attachmentsQuery = useAttachments()
  const createNote = useCreateNote()
  const [highlighterError, setHighlighterError] = useState(false)
  const [highlighterAttempt, setHighlighterAttempt] = useState(0)
  const [tree, setTree] = useState<ReactNode>(null)
  const [session] = useState(createPreviewSession)
  // The note's blocks by content key: after an edit only the edited ones are new.
  const blocksRef = useRef(new Map<string, HastContent>())

  const context = useMemo<PreviewContext>(
    () => ({
      theme: resolvedTheme,
      notes: linkTargets,
      folders: (foldersQuery.data ?? []).map(({ id, name }) => ({ id, name })),
      attachments: (attachmentsQuery.data ?? []).map(({ id, filename, mime }) => ({
        id,
        filename,
        mime,
      })),
    }),
    [resolvedTheme, linkTargets, foldersQuery.data, attachmentsQuery.data],
  )

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      const blocks = blocksRef.current
      const result = await session.render(context, content, new Set(blocks.keys()))
      if (cancelled || result.status === 'skipped') return
      if (result.status === 'error') {
        if (result.error === 'highlighter') setHighlighterError(true)
        else setTree(<p className="text-danger">Couldn't render this note.</p>)
        return
      }
      const next = new Map<string, HastContent>()
      const seen = new Map<string, number>()
      const children = result.keys.map((key) => {
        const block = next.get(key) ?? blocks.get(key) ?? result.blocks[key]
        next.set(key, block)
        // Identical blocks (two `---` rules) share a key; React keys must be unique.
        const repeat = seen.get(key) ?? 0
        seen.set(key, repeat + 1)
        return <PreviewBlock key={repeat ? `${key}:${repeat}` : key} block={block} />
      })
      blocksRef.current = next
      startTransition(() => setTree(children))
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [content, context, session, highlighterAttempt])

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
})

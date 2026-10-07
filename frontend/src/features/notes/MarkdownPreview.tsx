import {
  createContext,
  memo,
  startTransition,
  type ImgHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  useContext,
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

/** Whether checklist boxes can be clicked: only next to the editor (onToggleTask). */
const TasksClickable = createContext(false)

/** A checklist box. Uncontrolled, so a click shows at once, before the note is re-rendered
 * with the item's new `[x]` (a new block, so a new box); a click that can't be applied is
 * cancelled, which puts the box back. */
function PreviewCheckbox({ checked, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  const clickable = useContext(TasksClickable)
  if (props.type !== 'checkbox') return <input checked={checked} readOnly {...props} />
  return (
    <input
      {...props}
      defaultChecked={checked}
      disabled={!clickable}
      aria-label={checked ? 'Mark as not done' : 'Mark as done'}
    />
  )
}

let mathStyles: Promise<unknown> | null = null

/** KaTeX's stylesheet (and through it, its fonts) — only for notes with formulas. A
 * failure leaves the formulas unstyled rather than the note unrendered. */
function loadMathStyles(): Promise<unknown> {
  mathStyles ??= import('katex/dist/katex.min.css').catch(() => {
    mathStyles = null
  })
  return mathStyles
}

const toReact = unified().use(rehypeReact, {
  Fragment,
  jsx,
  jsxs,
  components: { img: PreviewImage, input: PreviewCheckbox },
}) as unknown as Processor

/** One top-level block of the note. An unchanged block comes back as the very same object,
 * so React skips it; a new one is converted here, inside the render — which a transition
 * can split up, so a long note doesn't hold the page in one long task. */
const PreviewBlock = memo(function PreviewBlock({ block }: { block: HastContent }) {
  const root: HastRoot = { type: 'root', children: [block] }
  return toReact.stringify(root) as ReactNode
})

/** What's on screen: the blocks, and the text and checkbox markers they came from. */
interface Rendered {
  nodes: ReactNode
  content: string
  tasks: number[]
}

/** Renders `content` as soon as it changes: while typing, it's given the text only once
 * typing pauses (useNoteAutosave's SETTLE_MS). `onToggleTask` makes checklist boxes
 * clickable: it gets the `[ ]`'s offset in `content` (the text on screen, which the editor
 * may since have moved past) and returns whether it applied the change. */
export const MarkdownPreview = memo(function MarkdownPreview({
  content,
  onToggleTask,
}: {
  content: string
  onToggleTask?: (offset: number, checked: boolean, content: string) => boolean
}) {
  const resolvedTheme = useResolvedTheme()
  const navigate = useNavigate()
  const linkTargets = useNoteLinkTargets()
  const foldersQuery = useFolders()
  const attachmentsQuery = useAttachments()
  const createNote = useCreateNote()
  const [highlighterError, setHighlighterError] = useState(false)
  const [highlighterAttempt, setHighlighterAttempt] = useState(0)
  const [tree, setTree] = useState<Rendered | null>(null)
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
        else
          setTree({
            nodes: <p className="text-danger">Couldn't render this note.</p>,
            content,
            tasks: [],
          })
        return
      }
      // Before showing the formulas, so they don't flash up unstyled.
      if (result.math) {
        await loadMathStyles()
        if (cancelled) return
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
      startTransition(() => setTree({ nodes: children, content, tasks: result.tasks }))
    }
    void render()
    return () => {
      cancelled = true
    }
  }, [content, context, session, highlighterAttempt])

  function handleClick(e: MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      // The boxes are in page order, as are the markers.
      const boxes = [...e.currentTarget.querySelectorAll('.task-list-item input[type="checkbox"]')]
      const offset = tree?.tasks[boxes.indexOf(target)] ?? -1
      const applied = offset >= 0 && tree && onToggleTask?.(offset, target.checked, tree.content)
      if (!applied) e.preventDefault()
      return
    }
    const link = target.closest<HTMLAnchorElement>('a[data-wikilink]')
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
    <TasksClickable.Provider value={onToggleTask !== undefined}>
      <div className="markdown-preview" onClick={handleClick}>
        {tree?.nodes ?? <p className="text-sm text-text-muted">Loading preview…</p>}
      </div>
    </TasksClickable.Provider>
  )
})

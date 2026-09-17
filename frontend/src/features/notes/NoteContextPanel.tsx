import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Link2 } from 'lucide-react'
import { EmptyState } from '@/design/components/EmptyState'
import { useBacklinks, useNote } from '@/features/notes/hooks'
import { useGraph } from '@/features/graph/hooks'
import { GraphCanvas } from '@/features/graph/GraphCanvas'

interface Heading {
  level: number
  text: string
}

function extractHeadings(content: string): Heading[] {
  const headings: Heading[] = []
  for (const line of content.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match) headings.push({ level: match[1].length, text: match[2].trim() })
  }
  return headings
}

function OutlineSection({ content }: { content: string }) {
  const headings = useMemo(() => extractHeadings(content), [content])

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Outline</h3>
      {headings.length === 0 ? (
        <p className="text-sm text-text-muted">No headings yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {headings.map((h, i) => (
            <li
              key={i}
              className="truncate text-sm text-text-muted"
              style={{ paddingLeft: (h.level - 1) * 10 }}
            >
              {h.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BacklinksSection({ noteId }: { noteId: string }) {
  const backlinks = useBacklinks(noteId)
  const navigate = useNavigate()

  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
        Backlinks
      </h3>
      {!backlinks.data || backlinks.data.length === 0 ? (
        <p className="text-sm text-text-muted">No notes link here yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {backlinks.data.map((link, i) => (
            <li key={`${link.source_note_id}-${i}`}>
              <button
                type="button"
                onClick={() => navigate(`/notes/${link.source_note_id}`)}
                className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-text hover:bg-surface-raised"
              >
                <Link2 size={13} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-muted" />
                <span className="truncate">
                  {link.source_note_title}
                  {link.heading && <span className="text-text-muted"> #{link.heading}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function LocalGraphSection({ noteId }: { noteId: string }) {
  const [depth, setDepth] = useState<1 | 2>(1)
  const graphQuery = useGraph({ noteId, depth })

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-text-muted">Local graph</h3>
        <div className="inline-flex rounded-md border border-border bg-bg p-0.5 text-xs">
          {([1, 2] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDepth(d)}
              className={clsx(
                'rounded px-1.5 py-0.5 transition-colors duration-150',
                depth === d ? 'bg-surface-raised text-text' : 'text-text-muted hover:text-text',
              )}
            >
              {d}
            </button>
          ))}
        </div>
      </div>
      {graphQuery.data && graphQuery.data.nodes.length > 1 ? (
        <GraphCanvas data={graphQuery.data} colorBy="folder" height={220} />
      ) : (
        <p className="text-sm text-text-muted">No connections yet.</p>
      )}
    </div>
  )
}

export function NoteContextPanel({ noteId }: { noteId: string }) {
  const note = useNote(noteId)

  if (!note.data) {
    return <EmptyState icon={Link2} title="Select a note" />
  }

  return (
    <div className="flex flex-col gap-6 px-3">
      <OutlineSection content={note.data.content} />
      <BacklinksSection noteId={noteId} />
      <LocalGraphSection noteId={noteId} />
    </div>
  )
}

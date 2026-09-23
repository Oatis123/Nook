import { Fragment, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search as SearchIcon } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { useUIStore } from '@/lib/ui-store'
import { useFolders } from '@/features/notes/hooks'
import { useSearch } from '@/features/search/hooks'

const SNIPPET_MARK_RE = /<mark>(.*?)<\/mark>/g

/** ts_headline wraps matches in literal `<mark>` text (see app/services/search.py) — this
 * splits on those markers and renders each piece as plain text, so nothing else in the
 * snippet (which comes straight from a note's own content) is ever parsed as HTML. */
function renderSnippet(snippet: string) {
  const parts: { text: string; highlighted: boolean }[] = []
  let lastIndex = 0
  for (const match of snippet.matchAll(SNIPPET_MARK_RE)) {
    if (match.index === undefined) continue
    if (match.index > lastIndex) {
      parts.push({ text: snippet.slice(lastIndex, match.index), highlighted: false })
    }
    parts.push({ text: match[1], highlighted: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < snippet.length) {
    parts.push({ text: snippet.slice(lastIndex), highlighted: false })
  }
  return parts.map((part, i) =>
    part.highlighted ? (
      <mark key={i} className="rounded-sm bg-accent/25 text-text">
        {part.text}
      </mark>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  )
}

export default function SearchPage() {
  const navigate = useNavigate()
  const foldersQuery = useFolders()
  const focusToken = useUIStore((s) => s.searchFocusToken)
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [focusToken])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(rawQuery), 250)
    return () => clearTimeout(timer)
  }, [rawQuery])

  const results = useSearch(query)
  const folderNameById = new Map((foldersQuery.data ?? []).map((f) => [f.id, f.name]))

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-4 font-serif text-2xl text-text">Search</h1>
      <div className="mb-2 flex items-center gap-2.5 rounded-md border border-border bg-surface px-3 py-2">
        <SearchIcon size={16} strokeWidth={1.5} className="text-text-muted" />
        <input
          ref={inputRef}
          autoFocus
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search notes…"
          className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        />
      </div>
      <p className="mb-6 text-xs text-text-muted">
        Filters: <code>tag:name</code>, <code>path:folder</code>, <code>in:notes</code>,{' '}
        <code>in:tasks</code>
      </p>

      {query.trim().length === 0 ? (
        <EmptyState icon={SearchIcon} title="Search across all your notes" />
      ) : results.data?.length === 0 ? (
        <EmptyState icon={SearchIcon} title={`No results for "${query}"`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {(results.data ?? []).map((result) => (
            <li key={result.id}>
              <button
                type="button"
                onClick={() => navigate(`/notes/${result.id}`)}
                className="block w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-sm hover:bg-surface-raised"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-text">{result.title}</span>
                  {result.folder_id && folderNameById.get(result.folder_id) && (
                    <span className="shrink-0 text-xs text-text-muted">
                      {folderNameById.get(result.folder_id)}
                    </span>
                  )}
                </div>
                {result.snippet && (
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">
                    {renderSnippet(result.snippet)}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

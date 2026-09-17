import { useNavigate, useParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { Hash } from 'lucide-react'
import { useTags } from '@/features/notes/hooks'

export function TagList() {
  const tagsQuery = useTags()
  const navigate = useNavigate()
  const { name: activeTag } = useParams<{ name: string }>()

  if (!tagsQuery.data || tagsQuery.data.length === 0) return null

  const sorted = [...tagsQuery.data].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mt-4 flex flex-col gap-0.5 px-2">
      <span className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-text-muted">
        Tags
      </span>
      {sorted.map((tag) => {
        const depth = tag.name.split('/').length - 1
        const label = tag.name.split('/').pop()!
        return (
          <button
            key={tag.name}
            type="button"
            onClick={() => navigate(`/tags/${encodeURIComponent(tag.name)}`)}
            className={clsx(
              'flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm hover:bg-surface-raised',
              activeTag === tag.name ? 'bg-surface-raised text-text' : 'text-text-muted',
            )}
            style={{ paddingLeft: depth * 14 + 4 }}
          >
            <Hash size={13} strokeWidth={1.5} className="shrink-0" />
            <span className="flex-1 truncate">{label}</span>
            <span className="text-xs text-text-muted">{tag.note_count}</span>
          </button>
        )
      })}
    </div>
  )
}

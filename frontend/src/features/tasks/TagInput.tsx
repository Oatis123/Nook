import { useState } from 'react'
import { clsx } from 'clsx'
import { X } from '@/design/icons'
import { MAX_TAGS, normalizeTag } from '@/features/tasks/taskTags'

/** Tag chips plus an input: Enter, comma or space adds what's typed, Backspace on an
 * empty input removes the last tag. */
export function TagInput({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)

  function commit(): boolean {
    if (!draft.trim()) return true
    const tag = normalizeTag(draft)
    if (!tag || (tags.length >= MAX_TAGS && !tags.includes(tag))) {
      setInvalid(true)
      return false
    }
    if (!tags.includes(tag)) onChange([...tags, tag])
    setDraft('')
    return true
  }

  return (
    <div
      className={clsx(
        'flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-surface px-1.5 py-1',
        invalid ? 'border-danger' : 'border-border focus-within:border-accent',
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className="flex items-center gap-0.5 rounded-full bg-surface-raised py-0.5 pl-2 pr-1 text-xs text-text"
        >
          #{tag}
          <button
            type="button"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="rounded-full p-0.5 text-text-muted hover:text-danger"
          >
            <X size={11} strokeWidth={2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          setInvalid(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === ' ') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
            onChange(tags.slice(0, -1))
          }
        }}
        onBlur={() => {
          if (!commit()) {
            setDraft('')
            setInvalid(false)
          }
        }}
        aria-label="Add tag"
        aria-invalid={invalid || undefined}
        placeholder={tags.length === 0 ? 'Add tags…' : ''}
        className="h-6 min-w-20 flex-1 bg-transparent px-1 text-sm text-text outline-none placeholder:text-text-muted"
      />
    </div>
  )
}

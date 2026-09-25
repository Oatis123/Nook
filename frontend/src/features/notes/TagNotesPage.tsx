import { useNavigate, useParams } from 'react-router-dom'
import { FileText, Hash } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { useNotes } from '@/features/notes/hooks'
import { QueryState } from '@/design/components/QueryState'

export default function TagNotesPage() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const notes = useNotes({ tag: name })

  if (!name) return null
  if (!notes.data) return <QueryState query={notes} />

  if (notes.data.length === 0) {
    return <EmptyState icon={Hash} title={`No notes tagged #${name}`} />
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="mb-6 flex items-center gap-2 font-serif text-2xl text-text">
        <Hash size={20} strokeWidth={1.5} className="text-text-muted" />
        {name}
      </h1>
      <ul className="flex flex-col gap-1">
        {notes.data.map((note) => (
          <li key={note.id}>
            <button
              type="button"
              onClick={() => navigate(`/notes/${note.id}`)}
              className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm hover:bg-surface"
            >
              <FileText size={15} strokeWidth={1.5} className="text-text-muted" />
              {note.title}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

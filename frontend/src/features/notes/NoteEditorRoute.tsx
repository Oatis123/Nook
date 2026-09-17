import { useParams } from 'react-router-dom'
import { NoteEditor } from '@/features/notes/NoteEditor'

export default function NoteEditorRoute() {
  const { noteId } = useParams<{ noteId: string }>()
  if (!noteId) return null
  return <NoteEditor noteId={noteId} />
}

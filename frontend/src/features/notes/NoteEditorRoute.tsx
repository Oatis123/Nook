import { useParams } from 'react-router-dom'
import { NoteEditor } from '@/features/notes/NoteEditor'

export default function NoteEditorRoute() {
  const { noteId } = useParams<{ noteId: string }>()
  if (!noteId) return null
  // Keyed so switching notes mounts a fresh editor: the old one flushes its pending
  // save for *its* note on unmount, and no state or timer can leak into the new one.
  return <NoteEditor key={noteId} noteId={noteId} />
}

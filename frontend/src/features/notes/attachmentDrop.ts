import { EditorView } from '@codemirror/view'

/** Intercepts paste/drop of files as a CodeMirror extension (not a React DOM handler on a
 * wrapper element) — CM6 attaches its own native paste/drop listeners directly to its
 * content element, which fire before any listener on an ancestor, so a wrapper-level
 * React onPaste/onDrop can't preempt CM's default "insert as text" behavior. Returning
 * `true` from these handlers is what stops that default handling. */
export function createAttachmentDropHandler(
  uploadAndInsert: (files: File[], pos: number | 'cursor', view: EditorView) => void,
) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length === 0) return false
      event.preventDefault()
      uploadAndInsert(files, 'cursor', view)
      return true
    },
    drop(event, view) {
      const files = Array.from(event.dataTransfer?.files ?? [])
      if (files.length === 0) return false
      event.preventDefault()
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
      uploadAndInsert(files, pos ?? 'cursor', view)
      return true
    },
  })
}

import type { CompletionContext, CompletionSource } from '@codemirror/autocomplete'
import type { NoteSummary, Tag } from '@/lib/types'

/** After `[[`, suggest note titles (and close the brackets on accept) — spec §6.2. */
export function createWikilinkCompletion(notes: NoteSummary[]): CompletionSource {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/\[\[[^[\]]*/)
    if (!match) return null
    if (match.from === match.to && !context.explicit) return null

    const query = match.text.slice(2).toLowerCase()
    const options = notes
      .filter((n) => n.title.toLowerCase().includes(query))
      .slice(0, 20)
      .map((n) => ({
        label: n.title,
        type: 'text',
        apply: (
          view: import('@codemirror/view').EditorView,
          _completion: unknown,
          from: number,
          to: number,
        ) => {
          view.dispatch({
            changes: { from, to, insert: `${n.title}]]` },
            selection: { anchor: from + n.title.length + 2 },
          })
        },
      }))

    return { from: match.from + 2, options }
  }
}

/** After `#`, suggest existing tags — spec §6.2. */
export function createTagCompletion(tags: Tag[]): CompletionSource {
  return (context: CompletionContext) => {
    const match = context.matchBefore(/#[\p{L}\p{N}_/-]*/u)
    if (!match) return null
    if (match.from === match.to && !context.explicit) return null

    const query = match.text.slice(1).toLowerCase()
    const options = tags
      .filter((t) => t.name.toLowerCase().includes(query))
      .slice(0, 20)
      .map((t) => ({ label: t.name, type: 'keyword', detail: `${t.note_count}` }))

    return { from: match.from + 1, options }
  }
}

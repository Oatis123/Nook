import { EditorView } from '@codemirror/view'

// Uses the app's CSS variables directly so it tracks the active theme without needing
// CodeMirror's own light/dark flag.
export const editorTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    height: '100%',
    fontSize: '14px',
  },
  '.cm-content': {
    fontFamily: 'var(--font-mono)',
    padding: '1rem 1.25rem',
    caretColor: 'var(--accent)',
    maxWidth: '72ch',
  },
  '.cm-scroller': {
    lineHeight: '1.7',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-gutters': {
    display: 'none',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent) 25%, transparent)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--accent)',
  },
  '.cm-placeholder': {
    color: 'var(--text-muted)',
  },
})

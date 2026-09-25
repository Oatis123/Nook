import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

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

/** Markdown syntax colors from the app's own tokens, so they follow light/dark mode and
 * the skin. CodeMirror's default highlight style is designed for light backgrounds
 * (links and code-block languages were ~1.4:1 on the dark theme). */
export const editorHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.heading, fontWeight: '600', color: 'var(--text)' },
    { tag: [tags.strong], fontWeight: '600' },
    { tag: [tags.emphasis], fontStyle: 'italic' },
    { tag: [tags.strikethrough], textDecoration: 'line-through' },
    { tag: [tags.link, tags.url], color: 'var(--accent)' },
    { tag: [tags.monospace, tags.labelName], color: 'var(--accent)' },
    { tag: [tags.quote], color: 'var(--text-muted)', fontStyle: 'italic' },
    {
      tag: [tags.processingInstruction, tags.meta, tags.contentSeparator, tags.list],
      color: 'var(--text-muted)',
    },
  ]),
)

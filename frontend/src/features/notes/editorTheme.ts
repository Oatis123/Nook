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
    // Centered like the rendered note, so the text stays in place when switching modes.
    margin: '0 auto',
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
  // The [[link]] and #tag suggestions. CodeMirror's own tooltip is a light grey plate
  // that kept the editor's (light, in dark mode) text color: white on near-white.
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--text)',
    border: '1px solid var(--oatis-dim, var(--border))',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-popover)',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-sm)',
    maxHeight: '16rem',
    padding: '2px 0',
  },
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li': {
    padding: '4px 10px',
    lineHeight: '1.5',
  },
  // A dense list: the current suggestion gets the moss bar, like menus and the palette.
  '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    backgroundColor: 'var(--bg)',
    color: 'var(--text)',
    boxShadow: 'inset 2px 0 0 var(--accent)',
  },
  '.cm-completionMatchedText': {
    textDecoration: 'none',
    fontWeight: '600',
  },
  '.cm-completionDetail': {
    color: 'var(--text-muted)',
    fontStyle: 'normal',
    marginLeft: '0.75em',
  },
  '.cm-completionIcon': {
    display: 'none',
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

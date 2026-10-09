import { memo, type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror, { type Extension, ExternalChange } from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { clsx } from 'clsx'
import { Download, Eye, Link2, Paperclip, Pencil } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { IconButton } from '@/design/components/IconButton'
import { Tooltip } from '@/design/components/Tooltip'
import { ApiError } from '@/lib/api'
import { getRenameImpact, noteExportUrl } from '@/features/notes/api'
import { editorHighlighting, editorTheme } from '@/features/notes/editorTheme'
import { useNote, useNoteLinkTargets, useTags } from '@/features/notes/hooks'
import {
  type EditorContent,
  type SaveStatus,
  useNoteAutosave,
} from '@/features/notes/useNoteAutosave'
import { createTagCompletion, createWikilinkCompletion } from '@/features/notes/autocomplete'
import { createAttachmentDropHandler } from '@/features/notes/attachmentDrop'
import { MarkdownPreview } from '@/features/notes/MarkdownPreview'
import { type NoteMode, setNoteMode, useNoteMode } from '@/features/notes/noteMode'
import { ConflictDialog } from '@/features/notes/ConflictDialog'
import { RenameLinksDialog } from '@/features/notes/RenameLinksDialog'
import { useUploadAttachment } from '@/features/attachments/hooks'
import { QueryState } from '@/design/components/QueryState'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

// Module-level so its identity is stable: @uiw/react-codemirror reconfigures the whole
// editor whenever this prop (or `extensions`) changes identity, and an inline object
// literal did that on every render — i.e. on every keystroke.
const EDITOR_BASIC_SETUP = { lineNumbers: false, foldGutter: false, highlightActiveLine: false }

export function NoteEditor({ noteId }: { noteId: string }) {
  const noteQuery = useNote(noteId)
  // Only the (stable) mutateAsync: useMutation returns a new object every render, and
  // depending on it rebuilt the editor's extensions — a full reconfigure — per keystroke.
  const { mutateAsync: uploadAttachment } = useUploadAttachment()
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autosave = useNoteAutosave(noteId, noteQuery.data)
  const { draft, editorContent, status, settle } = autosave
  useDocumentTitle(draft?.title ?? noteQuery.data?.title)

  const [renamePrompt, setRenamePrompt] = useState<{ affectedNotes: number } | null>(null)

  const linkTargets = useNoteLinkTargets()
  const tagsQuery = useTags()

  // Editing or reading: the last mode picked, on any note. A new, empty note opens for
  // writing whatever it was — there's nothing to read yet.
  const lastMode = useNoteMode()
  const [openedEmpty, setOpenedEmpty] = useState<boolean | null>(null)
  if (draft && openedEmpty === null) setOpenedEmpty(draft.content.trim() === '')
  const mode: NoteMode = openedEmpty ? 'edit' : lastMode
  // The preview is rendered from the first switch to reading on, then only hidden: a note
  // only ever edited never pays for it, and switching back and forth is instant.
  const [previewMounted, setPreviewMounted] = useState(false)
  if (mode === 'view' && !previewMounted) setPreviewMounted(true)

  const switchMode = useCallback(
    (next: NoteMode) => {
      setOpenedEmpty(false)
      // Reading right after typing: show the text as typed, not as of a moment ago.
      if (next === 'view') settle()
      setNoteMode(next)
      if (next === 'edit') requestAnimationFrame(() => viewRef.current?.focus())
    },
    [settle],
  )

  // A checklist box clicked in the preview flips its `[ ]` in the editor, like typing it
  // would — so it's autosaved, and Ctrl+Z undoes it.
  const toggleTask = useCallback((offset: number, checked: boolean, shown: string) => {
    const view = viewRef.current
    if (!view) return false
    const doc = view.state.doc
    // The preview trails typing by a moment: a box from text that has changed since is
    // refused rather than applied to the wrong place.
    if (doc.length !== shown.length || doc.toString() !== shown) return false
    if (!/^\[[ xX]\]$/.test(doc.sliceString(offset, offset + 3))) return false
    view.dispatch({
      changes: { from: offset + 1, to: offset + 2, insert: checked ? 'x' : ' ' },
      userEvent: 'input.toggle-task',
    })
    return true
  }, [])

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        switchMode(mode === 'edit' ? 'view' : 'edit')
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [mode, switchMode])

  // Title changes are saved explicitly on blur/Enter, not on every keystroke like
  // content — renaming needs a settled title to check link impact against.
  async function handleTitleBlur() {
    if (!autosave.titleChanged()) {
      autosave.commitTitle(false) // normalizes whitespace / restores an emptied title
      return
    }
    let affected = 0
    try {
      affected = (await getRenameImpact(noteId)).affected_notes
    } catch {
      // Can't check link impact right now; rename without touching links.
    }
    if (affected > 0) setRenamePrompt({ affectedNotes: affected })
    else autosave.commitTitle(false)
  }

  function resolveRenamePrompt(updateLinks: boolean) {
    setRenamePrompt(null)
    autosave.commitTitle(updateLinks)
  }

  const uploadAndInsert = useCallback(
    async (files: File[], pos: number | 'cursor', view: EditorView) => {
      // A failed upload is already reported by the global mutation error toast.
      const uploaded = await Promise.all(files.map((f) => uploadAttachment(f))).catch(() => null)
      if (!uploaded) return
      const insertPos = pos === 'cursor' ? view.state.selection.main.from : pos
      const embedText = uploaded.map((a) => `![[${a.filename}]]`).join(' ')
      view.dispatch({
        changes: { from: insertPos, to: insertPos, insert: embedText },
        selection: { anchor: insertPos + embedText.length },
      })
      view.focus()
    },
    [uploadAttachment],
  )

  const editorExtensions = useMemo(
    () => [
      markdown(),
      EditorView.lineWrapping,
      editorTheme,
      editorHighlighting,
      createAttachmentDropHandler(uploadAndInsert),
      autocompletion({
        override: [
          createWikilinkCompletion(linkTargets),
          createTagCompletion(tagsQuery.data ?? []),
        ],
      }),
    ],
    [linkTargets, tagsQuery.data, uploadAndInsert],
  )

  // Only when there's nothing to show: a failed *background* refetch (API restarting
  // mid-deploy) must not replace an open editor, and its undo history, with an error.
  if (noteQuery.isError && !noteQuery.data) {
    if (noteQuery.error instanceof ApiError && noteQuery.error.status === 404) {
      return <EmptyState icon={Link2} title="This note doesn't exist or was deleted." />
    }
    return <QueryState query={noteQuery} />
  }
  if (noteQuery.isLoading || !draft || !editorContent) return null

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <input
            value={draft.title}
            maxLength={255}
            onChange={(e) => autosave.setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            className="w-full truncate bg-transparent font-serif text-xl text-text outline-none"
            aria-label="Note title"
            aria-invalid={autosave.titleError ? true : undefined}
            aria-describedby={autosave.titleError ? 'note-title-error' : undefined}
          />
          {autosave.titleError && (
            <p id="note-title-error" role="alert" className="mt-0.5 text-xs text-danger">
              {autosave.titleError}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <SaveIndicator status={status} />
          <Tooltip label="Attach a file">
            <IconButton label="Attach a file" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={16} strokeWidth={1.5} />
            </IconButton>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            aria-label="Attach a file"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              if (files.length > 0 && viewRef.current) {
                uploadAndInsert(files, 'cursor', viewRef.current)
              }
              e.target.value = ''
            }}
          />
          <Tooltip label="Export as .md">
            <a
              href={noteExportUrl(noteId)}
              download
              aria-label="Export as .md"
              title="Export as .md"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-muted transition-colors duration-150 hover:bg-surface hover:text-text"
            >
              <Download size={16} strokeWidth={1.5} />
            </a>
          </Tooltip>
          <ModeSwitch mode={mode} onChange={switchMode} />
        </div>
      </header>

      {autosave.fatalError && (
        <p
          role="alert"
          className="border-b border-border bg-danger/10 px-6 py-2 text-sm text-danger"
        >
          {autosave.fatalError}
        </p>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Hidden, not unmounted, while reading: the editor holds the text, its undo
            history and cursor — and a checklist box ticked while reading is typed into it. */}
        <div className={clsx('min-w-0 flex-1 overflow-y-auto', mode === 'view' && 'hidden')}>
          <NoteCodeMirror
            content={editorContent}
            onChange={autosave.setContent}
            extensions={editorExtensions}
            viewRef={viewRef}
          />
        </div>

        {/* Padded like the editor's text, so switching modes doesn't shift it. contain: it
            scrolls and clips already, and its layout stays its own. */}
        {previewMounted && (
          <div
            className={clsx(
              'min-w-0 flex-1 overflow-y-auto px-5 py-4 [contain:layout_paint_style]',
              mode === 'edit' && 'hidden',
            )}
          >
            {draft.content.trim() ? (
              <MarkdownPreview content={draft.content} onToggleTask={toggleTask} />
            ) : (
              <p className="text-sm text-text-muted">This note is empty.</p>
            )}
          </div>
        )}
      </div>

      <ConflictDialog
        open={autosave.conflict !== null}
        myContent={draft.content}
        serverContent={autosave.conflict?.content ?? ''}
        onKeepMine={autosave.keepMine}
        onLoadServer={autosave.loadServer}
      />

      <RenameLinksDialog
        open={renamePrompt !== null}
        affectedNotes={renamePrompt?.affectedNotes ?? 0}
        onUpdateLinks={() => resolveRenamePrompt(true)}
        onSkip={() => resolveRenamePrompt(false)}
      />
    </div>
  )
}

/** The editor owns its text while you type (nothing re-renders per keystroke); text that
 * comes from elsewhere — a newer server copy, the version picked in a conflict — is put
 * in here. */
const NoteCodeMirror = memo(function NoteCodeMirror({
  content,
  onChange,
  extensions,
  viewRef,
}: {
  content: EditorContent
  onChange: (content: string) => void
  extensions: Extension[]
  viewRef: RefObject<EditorView | null>
}) {
  // @uiw/react-codemirror re-syncs the document whenever `value` changes, deferring while
  // you type — fed the typed text with a lag, that could put back stale text. It only
  // ever gets the text the editor opened with; replacements are dispatched below.
  const [initialText] = useState(content.text)

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === content.text) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content.text },
      annotations: [ExternalChange.of(true)],
    })
  }, [content, viewRef])

  return (
    <CodeMirror
      value={initialText}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view
      }}
      extensions={extensions}
      basicSetup={EDITOR_BASIC_SETUP}
      theme="none"
      height="100%"
      className="h-full"
    />
  )
})

const MODES: { value: NoteMode; label: string; icon: typeof Eye }[] = [
  { value: 'edit', label: 'Edit', icon: Pencil },
  { value: 'view', label: 'View', icon: Eye },
]

/** Edit / View, styled like the app's other segmented controls (skins restyle them). */
function ModeSwitch({ mode, onChange }: { mode: NoteMode; onChange: (mode: NoteMode) => void }) {
  return (
    <Tooltip label="Edit or view (Ctrl/Cmd+E)">
      <div
        role="radiogroup"
        aria-label="Mode"
        className="ui-segmented inline-flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5"
      >
        {MODES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            aria-label={label}
            data-active={mode === value}
            onClick={() => onChange(value)}
            className={clsx(
              'ui-segment inline-flex h-7 items-center justify-center gap-1.5 rounded px-2 text-sm transition-colors duration-150',
              mode === value
                ? 'bg-surface-raised text-text shadow-sm'
                : 'text-text-muted hover:text-text',
            )}
          >
            <Icon size={15} strokeWidth={1.5} />
            <span className="max-sm:hidden">{label}</span>
          </button>
        ))}
      </div>
    </Tooltip>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  // Short labels on phones, where the status shares the header row with the title.
  const [short, long] = {
    saved: ['Saved', 'Saved'],
    saving: ['Saving…', 'Saving…'],
    offline: ['Offline', 'Offline — saved on this device'],
    retrying: ['Retrying', 'Couldn’t save — retrying'],
    conflict: ['Conflict', 'Changed elsewhere — choose a version'],
    error: ['Not saved', 'Couldn’t save'],
  }[status]
  const color =
    status === 'error' || status === 'retrying' || status === 'conflict'
      ? 'text-danger'
      : 'text-text-muted'
  return (
    <span role="status" className={`shrink-0 text-xs ${color}`}>
      <span className="md:hidden">{short}</span>
      <span className="hidden md:inline">{long}</span>
    </span>
  )
}

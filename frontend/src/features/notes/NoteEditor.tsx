import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { Download, Eye, EyeOff, Link2, Paperclip } from '@/design/icons'
import { EmptyState } from '@/design/components/EmptyState'
import { IconButton } from '@/design/components/IconButton'
import { Tooltip } from '@/design/components/Tooltip'
import { ApiError } from '@/lib/api'
import { useCurrentUser, useUpdateProfile } from '@/features/auth/hooks'
import { getRenameImpact, noteExportUrl } from '@/features/notes/api'
import { editorHighlighting, editorTheme } from '@/features/notes/editorTheme'
import { useNote, useNotes, useTags } from '@/features/notes/hooks'
import { type SaveStatus, useNoteAutosave } from '@/features/notes/useNoteAutosave'
import { createTagCompletion, createWikilinkCompletion } from '@/features/notes/autocomplete'
import { createAttachmentDropHandler } from '@/features/notes/attachmentDrop'
import { MarkdownPreview } from '@/features/notes/MarkdownPreview'
import { ConflictDialog } from '@/features/notes/ConflictDialog'
import { RenameLinksDialog } from '@/features/notes/RenameLinksDialog'
import { useUploadAttachment } from '@/features/attachments/hooks'
import { QueryState } from '@/design/components/QueryState'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function NoteEditor({ noteId }: { noteId: string }) {
  const noteQuery = useNote(noteId)
  const { data: user } = useCurrentUser()
  const updateProfile = useUpdateProfile()
  const uploadAttachment = useUploadAttachment()
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const autosave = useNoteAutosave(noteId, noteQuery.data)
  const { draft, status } = autosave
  useDocumentTitle(draft?.title ?? noteQuery.data?.title)

  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [renamePrompt, setRenamePrompt] = useState<{ affectedNotes: number } | null>(null)

  const notesQuery = useNotes()
  const tagsQuery = useTags()

  const previewEnabled = user?.editor_preview_enabled ?? true

  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        updateProfile.mutate({ editor_preview_enabled: !previewEnabled })
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewEnabled])

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
      const uploaded = await Promise.all(files.map((f) => uploadAttachment.mutateAsync(f))).catch(
        () => null,
      )
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
          createWikilinkCompletion(notesQuery.data ?? []),
          createTagCompletion(tagsQuery.data ?? []),
        ],
      }),
    ],
    [notesQuery.data, tagsQuery.data, uploadAndInsert],
  )

  // Only when there's nothing to show: a failed *background* refetch (API restarting
  // mid-deploy) must not replace an open editor, and its undo history, with an error.
  if (noteQuery.isError && !noteQuery.data) {
    if (noteQuery.error instanceof ApiError && noteQuery.error.status === 404) {
      return <EmptyState icon={Link2} title="This note doesn't exist or was deleted." />
    }
    return <QueryState query={noteQuery} />
  }
  if (noteQuery.isLoading || !draft) return null

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
          <Tooltip label="Toggle preview (Ctrl/Cmd+E)">
            <IconButton
              label="Toggle preview"
              active={previewEnabled}
              onClick={() => updateProfile.mutate({ editor_preview_enabled: !previewEnabled })}
              className="max-md:hidden"
            >
              {previewEnabled ? (
                <Eye size={16} strokeWidth={1.5} />
              ) : (
                <EyeOff size={16} strokeWidth={1.5} />
              )}
            </IconButton>
          </Tooltip>
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

      <div className="flex md:hidden">
        {(['edit', 'preview'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setMobileTab(tab)}
            className={`flex-1 border-b-2 py-2 text-sm capitalize ${
              mobileTab === tab ? 'border-accent text-text' : 'border-transparent text-text-muted'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className={`min-w-0 flex-1 overflow-y-auto ${
            mobileTab === 'preview' ? 'hidden md:block' : ''
          }`}
        >
          <CodeMirror
            value={draft.content}
            onChange={autosave.setContent}
            onCreateEditor={(view) => {
              viewRef.current = view
            }}
            extensions={editorExtensions}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            theme="none"
            height="100%"
            className="h-full"
          />
        </div>

        {previewEnabled && (
          <div
            className={`min-w-0 flex-1 overflow-y-auto border-l border-border px-6 py-4 md:block ${
              mobileTab === 'edit' ? 'hidden' : ''
            }`}
          >
            <MarkdownPreview content={draft.content} />
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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { EditorView } from '@codemirror/view'
import { autocompletion } from '@codemirror/autocomplete'
import { Download, Eye, EyeOff, Link2, Paperclip } from 'lucide-react'
import { EmptyState } from '@/design/components/EmptyState'
import { IconButton } from '@/design/components/IconButton'
import { Tooltip } from '@/design/components/Tooltip'
import { ApiError } from '@/lib/api'
import { useCurrentUser, useUpdateProfile } from '@/features/auth/hooks'
import { getNote, getRenameImpact, noteExportUrl } from '@/features/notes/api'
import { editorTheme } from '@/features/notes/editorTheme'
import { useNote, useNotes, useTags, useUpdateNote } from '@/features/notes/hooks'
import { createTagCompletion, createWikilinkCompletion } from '@/features/notes/autocomplete'
import { createAttachmentDropHandler } from '@/features/notes/attachmentDrop'
import { MarkdownPreview } from '@/features/notes/MarkdownPreview'
import { ConflictDialog } from '@/features/notes/ConflictDialog'
import { RenameLinksDialog } from '@/features/notes/RenameLinksDialog'
import { useUploadAttachment } from '@/features/attachments/hooks'
import type { NoteDetail } from '@/lib/types'

const SAVE_DEBOUNCE_MS = 800

type SaveStatus = 'saved' | 'saving' | 'offline' | 'error'

export function NoteEditor({ noteId }: { noteId: string }) {
  const noteQuery = useNote(noteId)
  const updateNote = useUpdateNote(noteId)
  const { data: user } = useCurrentUser()
  const updateProfile = useUpdateProfile()
  const uploadAttachment = useUploadAttachment()
  const viewRef = useRef<EditorView | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft] = useState<{ title: string; content: string; version: number } | null>(
    null,
  )
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<NoteDetail | null>(null)
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')
  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null)
  const [renamePrompt, setRenamePrompt] = useState<{ affectedNotes: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(draft)
  const lastSavedTitleRef = useRef<string | null>(null)

  const notesQuery = useNotes()
  const tagsQuery = useTags()

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  const previewEnabled = user?.editor_preview_enabled ?? true

  // Reset the local draft when a different note loads, but not on every background
  // refetch of the same note, so in-flight typing isn't clobbered. Runs during render
  // (React's documented pattern for adjusting state from a changed id/prop) rather than
  // in an effect, since it only needs to happen once per noteId, not after every commit.
  if (noteQuery.data && loadedNoteId !== noteId) {
    setDraft({
      title: noteQuery.data.title,
      content: noteQuery.data.content,
      version: noteQuery.data.version,
    })
    setStatus('saved')
    setLoadedNoteId(noteId)
    lastSavedTitleRef.current = noteQuery.data.title
  }

  useEffect(() => {
    function handleOffline() {
      setStatus('offline')
    }
    function handleOnline() {
      setStatus((s) => (s === 'offline' ? 'saved' : s))
    }
    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [])

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

  function scheduleSave(next: { title: string; content: string }) {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => save(next), SAVE_DEBOUNCE_MS)
  }

  async function save(next: { title: string; content: string }, updateLinks = false) {
    const current = draftRef.current
    if (!current) return
    if (!navigator.onLine) {
      setStatus('offline')
      return
    }
    setStatus('saving')
    try {
      const result = await updateNote.mutateAsync({
        version: current.version,
        title: next.title,
        content: next.content,
        update_links: updateLinks,
      })
      setDraft({ title: result.title, content: result.content, version: result.version })
      lastSavedTitleRef.current = result.title
      setStatus('saved')
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        const server = await getNote(noteId)
        setConflict(server)
      }
      setStatus('error')
    }
  }

  function handleContentChange(content: string) {
    if (!draft) return
    const next = { ...draft, content }
    setDraft(next)
    scheduleSave(next)
  }

  function handleTitleChange(title: string) {
    if (!draft) return
    // Title changes are saved explicitly on blur/Enter (see handleTitleBlur), not on
    // every keystroke like content — renaming needs a settled title to check link
    // impact against, and debouncing it too raced the impact check against the
    // autosave in practice (whichever fired first "won", so the cascade dialog was
    // easy to miss).
    setDraft({ ...draft, title })
  }

  async function handleTitleBlur() {
    if (!draft) return
    if (draft.title === lastSavedTitleRef.current) return
    if (timerRef.current) clearTimeout(timerRef.current)
    const impact = await getRenameImpact(noteId)
    if (impact.affected_notes > 0) {
      setRenamePrompt({ affectedNotes: impact.affected_notes })
    } else {
      save(draft, false)
    }
  }

  function resolveRenamePrompt(updateLinks: boolean) {
    setRenamePrompt(null)
    if (draft) save(draft, updateLinks)
  }

  function resolveKeepMine() {
    if (!draft || !conflict) return
    const next = { ...draft, version: conflict.version }
    draftRef.current = next
    setDraft(next)
    setConflict(null)
    scheduleSave(next)
  }

  function resolveLoadServer() {
    if (!conflict) return
    setDraft({ title: conflict.title, content: conflict.content, version: conflict.version })
    setConflict(null)
    setStatus('saved')
  }

  const uploadAndInsert = useCallback(
    async (files: File[], pos: number | 'cursor') => {
      const uploaded = await Promise.all(files.map((f) => uploadAttachment.mutateAsync(f)))
      const view = viewRef.current
      if (!view) return
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

  if (noteQuery.isLoading || !draft) return null

  if (noteQuery.isError) {
    return <EmptyState icon={Link2} title="This note doesn't exist or was deleted." />
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <input
          value={draft.title}
          onChange={(e) => handleTitleChange(e.target.value)}
          onBlur={handleTitleBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="min-w-0 flex-1 truncate bg-transparent font-serif text-xl text-text outline-none"
          aria-label="Note title"
        />
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
              if (files.length > 0) uploadAndInsert(files, 'cursor')
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
              className="hidden md:inline-flex"
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
            onChange={handleContentChange}
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
        open={conflict !== null}
        myContent={draft.content}
        serverContent={conflict?.content ?? ''}
        onKeepMine={resolveKeepMine}
        onLoadServer={resolveLoadServer}
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
  const label = {
    saved: 'Saved',
    saving: 'Saving…',
    offline: 'Offline',
    error: 'Couldn’t save',
  }[status]
  const color = status === 'error' ? 'text-danger' : 'text-text-muted'
  return <span className={`text-xs ${color}`}>{label}</span>
}

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as RadixDialog from '@radix-ui/react-dialog'
import {
  Calendar,
  CalendarClock,
  CalendarRange,
  FileText,
  ListTodo,
  Network,
  Paperclip,
  Plus,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import { useUIStore } from '@/lib/ui-store'
import { fuzzyFilter } from '@/lib/fuzzy'
import { useCreateNote, useNotes } from '@/features/notes/hooks'
import { uniqueNoteTitle } from '@/features/notes/tree'
import { useTasks } from '@/features/tasks/hooks'

interface Entry {
  key: string
  label: string
  hint?: string
  icon: typeof FileText
  onSelect: () => void
}

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const navigate = useNavigate()
  const notesQuery = useNotes()
  const tasksQuery = useTasks({})
  const createNote = useCreateNote()
  const [query, setQuery] = useState('')
  const [lastQuery, setLastQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [wasOpen, setWasOpen] = useState(open)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useUIStore.getState().commandPaletteOpen)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  // Reset the query when the dialog transitions to closed — adjusted during render
  // (React's documented pattern for resetting state from a changed prop) since `open`
  // can flip from outside this component's own handlers (the global Ctrl/Cmd+K listener
  // above), so a plain effect-on-close would miss transitions an effect never saw fire.
  if (open !== wasOpen) {
    setWasOpen(open)
    if (!open) {
      setQuery('')
      setLastQuery('')
      setActiveIndex(0)
    }
  }

  function go(path: string) {
    navigate(path)
    setOpen(false)
  }

  function createAndOpenNote() {
    const notes = notesQuery.data ?? []
    const title = uniqueNoteTitle('Untitled', notes, null)
    createNote.mutate({ title, folder_id: null }, { onSuccess: (note) => go(`/notes/${note.id}`) })
  }

  const commands: Entry[] = [
    { key: 'cmd-new-note', label: 'New note', icon: Plus, onSelect: createAndOpenNote },
    { key: 'cmd-notes', label: 'Go to Notes', icon: FileText, onSelect: () => go('/notes') },
    { key: 'cmd-tasks', label: 'Go to Tasks', icon: ListTodo, onSelect: () => go('/tasks') },
    {
      key: 'cmd-today',
      label: 'Go to Today',
      icon: CalendarClock,
      onSelect: () => go('/tasks/today'),
    },
    {
      key: 'cmd-upcoming',
      label: 'Go to Upcoming',
      icon: CalendarRange,
      onSelect: () => go('/tasks/upcoming'),
    },
    {
      key: 'cmd-calendar',
      label: 'Go to Calendar',
      icon: Calendar,
      onSelect: () => go('/tasks/calendar'),
    },
    { key: 'cmd-graph', label: 'Go to Graph', icon: Network, onSelect: () => go('/graph') },
    { key: 'cmd-search', label: 'Go to Search', icon: Search, onSelect: () => go('/search') },
    {
      key: 'cmd-attachments',
      label: 'Go to Attachments',
      icon: Paperclip,
      onSelect: () => go('/attachments'),
    },
    { key: 'cmd-trash', label: 'Go to Trash', icon: Trash2, onSelect: () => go('/trash') },
    {
      key: 'cmd-settings',
      label: 'Go to Settings',
      icon: Settings,
      onSelect: () => go('/settings'),
    },
  ]

  const noteEntries: Entry[] = (notesQuery.data ?? []).map((note) => ({
    key: note.id,
    label: note.title,
    hint: 'Note',
    icon: FileText,
    onSelect: () => go(`/notes/${note.id}`),
  }))

  const taskEntries: Entry[] = (tasksQuery.data ?? []).map((task) => ({
    key: task.id,
    label: task.title,
    hint: 'Task',
    icon: ListTodo,
    onSelect: () => go(`/tasks/list/${task.list_id}`),
  }))

  const results = useMemo(() => {
    const all = [...noteEntries, ...taskEntries, ...commands]
    return fuzzyFilter(query, all, (entry) => entry.label).slice(0, 20)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commands/noteEntries/taskEntries are rebuilt fresh every render from stable inputs; including them would just re-run this every render regardless
  }, [query, notesQuery.data, tasksQuery.data])

  if (query !== lastQuery && open === wasOpen) {
    setLastQuery(query)
    if (activeIndex !== 0) setActiveIndex(0)
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      results[activeIndex]?.onSelect()
    }
  }

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <RadixDialog.Content
          className={[
            'fixed left-1/2 top-[20vh] z-50 w-[90vw] max-w-lg -translate-x-1/2',
            'rounded-lg border border-border bg-surface-raised shadow-(--shadow-popover)',
            'animate-fade-in',
          ].join(' ')}
          onKeyDown={handleKeyDown}
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search size={16} strokeWidth={1.5} className="text-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search notes, tasks, commands…"
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>
          <ul role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto py-1.5">
            {results.length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-text-muted">No matches</li>
            )}
            {results.map((entry, i) => (
              <li key={entry.key} role="option" aria-selected={i === activeIndex}>
                <button
                  type="button"
                  onClick={entry.onSelect}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={[
                    'flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm transition-colors duration-100',
                    i === activeIndex ? 'bg-accent/15 text-text' : 'text-text hover:bg-surface',
                  ].join(' ')}
                >
                  <entry.icon size={15} strokeWidth={1.5} className="shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint && (
                    <span className="shrink-0 text-xs text-text-muted">{entry.hint}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

import { useEffect } from 'react'
import { Outlet, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  FileText,
  ListTodo,
  Network,
  Paperclip,
  Search,
  Trash2,
  Settings,
  Shield,
  PanelLeft,
  PanelRight,
  Menu,
  ChevronsUpDown,
} from 'lucide-react'
import { clsx } from 'clsx'
import { APP_NAME } from '@/lib/env'
import { useUIStore } from '@/lib/ui-store'
import { IconButton } from '@/design/components/IconButton'
import { ThemeToggle } from '@/design/components/ThemeToggle'
import { Tooltip } from '@/design/components/Tooltip'
import { DropdownMenu } from '@/design/components/DropdownMenu'
import { CommandPalette } from '@/features/shell/CommandPalette'
import { useCurrentUser, useLogout } from '@/features/auth/hooks'
import { FolderTree } from '@/features/notes/FolderTree'
import { TagList } from '@/features/notes/TagList'
import { NoteContextPanel } from '@/features/notes/NoteContextPanel'
import { TaskListSidebar } from '@/features/tasks/TaskListSidebar'

const navItems = [
  { to: '/graph', label: 'Graph', icon: Network },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/attachments', label: 'Attachments', icon: Paperclip },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const focusSearch = useUIStore((s) => s.focusSearch)
  const location = useLocation()
  const navigate = useNavigate()
  const { noteId } = useParams<{ noteId: string }>()
  const section = location.pathname.startsWith('/tasks') ? 'tasks' : 'notes'
  const { data: user } = useCurrentUser()
  const logout = useLogout()

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        navigate('/search')
        focusSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, focusSearch])

  const items =
    user?.role === 'admin'
      ? [...navItems, { to: '/admin', label: 'Admin', icon: Shield }]
      : navItems

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface',
          'transition-transform duration-150 md:relative md:inset-auto md:transition-[width]',
          sidebarOpen
            ? 'translate-x-0'
            : '-translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0',
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="font-serif text-base">{APP_NAME}</span>
          <IconButton
            label="Collapse sidebar"
            onClick={toggleSidebar}
            className="hidden md:inline-flex"
          >
            <PanelLeft size={16} strokeWidth={1.5} />
          </IconButton>
        </div>

        <div className="px-3">
          <div className="inline-flex w-full rounded-md border border-border bg-bg p-0.5">
            <NavLink
              to="/notes"
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm transition-colors duration-150',
                  isActive || section === 'notes'
                    ? 'bg-surface-raised text-text shadow-sm'
                    : 'text-text-muted hover:text-text',
                )
              }
            >
              <FileText size={15} strokeWidth={1.5} />
              Notes
            </NavLink>
            <NavLink
              to="/tasks"
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded px-2 py-1.5 text-sm transition-colors duration-150',
                  isActive
                    ? 'bg-surface-raised text-text shadow-sm'
                    : 'text-text-muted hover:text-text',
                )
              }
            >
              <ListTodo size={15} strokeWidth={1.5} />
              Tasks
            </NavLink>
          </div>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto">
          {section === 'notes' ? (
            <>
              <FolderTree />
              <TagList />
            </>
          ) : (
            <TaskListSidebar />
          )}
        </div>

        <nav className="shrink-0 border-t border-border px-2 py-2">
          <ul className="flex flex-col gap-0.5">
            {items.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  className={({ isActive }) =>
                    clsx(
                      'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150',
                      isActive
                        ? 'bg-surface-raised text-text'
                        : 'text-text-muted hover:text-text hover:bg-surface-raised/60',
                    )
                  }
                >
                  <Icon size={16} strokeWidth={1.5} />
                  {label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {user && (
          <div className="border-t border-border px-2 py-2">
            <DropdownMenu
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-text hover:bg-surface-raised"
                >
                  <span className="truncate">{user.username}</span>
                  <ChevronsUpDown size={14} strokeWidth={1.5} className="text-text-muted" />
                </button>
              }
              items={[
                { label: 'Settings', onSelect: () => navigate('/settings') },
                { label: 'Log out', onSelect: () => logout.mutate() },
              ]}
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-3 py-3">
          <ThemeToggle />
          <Tooltip label="Command palette (Ctrl/Cmd+K)">
            <IconButton label="Open command palette" onClick={() => setCommandPaletteOpen(true)}>
              <Search size={16} strokeWidth={1.5} />
            </IconButton>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
          <IconButton
            label="Open menu"
            onClick={toggleSidebar}
            className={sidebarOpen ? 'md:hidden' : 'inline-flex'}
          >
            <Menu size={18} strokeWidth={1.5} />
          </IconButton>
          <span className="font-serif text-sm md:hidden">{APP_NAME}</span>
          <span className="hidden flex-1 md:block" />
          <IconButton
            label="Toggle context panel"
            onClick={toggleRightPanel}
            active={rightPanelOpen}
          >
            <PanelRight size={16} strokeWidth={1.5} />
          </IconButton>
        </header>

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>

          <aside
            className={clsx(
              'hidden shrink-0 flex-col border-l border-border bg-surface transition-[width] duration-150 md:flex',
              rightPanelOpen ? 'w-72' : 'w-0 overflow-hidden',
            )}
          >
            <div className="px-3 py-3">
              <span className="text-sm text-text-muted">Context</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {noteId ? (
                <NoteContextPanel noteId={noteId} />
              ) : (
                <p className="px-3 text-sm text-text-muted">
                  Backlinks, linked tasks and the outline will appear here.
                </p>
              )}
            </div>
          </aside>
        </div>
      </div>

      <CommandPalette />
    </div>
  )
}

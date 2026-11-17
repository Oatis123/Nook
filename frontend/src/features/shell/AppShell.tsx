import { useEffect, useMemo } from 'react'
import { Link, Outlet, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  Folder,
  Inbox,
  ListTodo,
  Network,
  Paperclip,
  Search,
  Trash2,
  Settings,
  Shield,
  Sun,
  PanelLeft,
  PanelRight,
  Menu,
  ChevronsUpDown,
  TriangleAlert,
} from '@/design/icons'
import { clsx } from 'clsx'
import { APP_NAME } from '@/lib/env'
import { useUIStore } from '@/lib/ui-store'
import { IconButton } from '@/design/components/IconButton'
import { ThemeToggle } from '@/design/components/ThemeToggle'
import { Tooltip } from '@/design/components/Tooltip'
import { DropdownMenu } from '@/design/components/DropdownMenu'
import { CommandPalette } from '@/features/shell/CommandPalette'
import { useCurrentUser, useLogout } from '@/features/auth/hooks'
import { ConnectionBanner } from '@/features/shell/ConnectionBanner'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { useFolders, useNote, useNotes } from '@/features/notes/hooks'
import { NoteContextPanel } from '@/features/notes/NoteContextPanel'
import { TaskListSidebar } from '@/features/tasks/TaskListSidebar'
import { prefetchCommonPages } from '@/app/prefetch'
import { useTaskLists } from '@/features/tasks/hooks'
import { FilesDrawer } from '@/features/workspaces/FilesDrawer'
import {
  lastNote,
  rememberNote,
  workspaceByFolder,
  workspacePath,
} from '@/features/workspaces/workspaces'
import type { Folder as WorkspaceFolder } from '@/lib/types'

const navItems = [
  { to: '/graph', label: 'Graph', icon: Network },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/attachments', label: 'Attachments', icon: Paperclip },
  { to: '/trash', label: 'Trash', icon: Trash2 },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const workspaceNav =
  'ui-nav-item flex min-w-0 items-center gap-2.5 px-2.5 py-2 text-sm text-text-muted'

export function AppShell() {
  const sidebarOpen = useUIStore((s) => s.sidebarOpen)
  const toggleSidebar = useUIStore((s) => s.toggleSidebar)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const setCommandPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen)
  const focusSearch = useUIStore((s) => s.focusSearch)
  const location = useLocation()
  const navigate = useNavigate()
  const { noteId, workspaceId, listId } = useParams()
  const tasksSection = location.pathname.startsWith('/tasks')
  const inbox =
    location.pathname === '/notes' && new URLSearchParams(location.search).get('view') === 'inbox'
  const { data: user } = useCurrentUser()
  const { data: folders } = useFolders()
  const { data: notes } = useNotes()
  const { data: openNote } = useNote(noteId)
  const { data: taskLists } = useTaskLists()
  const workspaces = folders?.filter((folder) => folder.parent_id === null) ?? []
  const note = openNote ?? notes?.find((entry) => entry.id === noteId)
  const taskList = taskLists?.find((entry) => entry.id === listId)
  const workspaceMap = useMemo(() => workspaceByFolder(folders), [folders])
  const activeWorkspace = workspaceMap.get(
    workspaceId ?? note?.folder_id ?? taskList?.workspace_id ?? '',
  )
  const activeWorkspaceId = activeWorkspace?.id
  const logout = useLogout()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  // On phones the sidebar is a drawer over the page: while it's open the page behind it
  // is inert (no focus, no screen reader), and Esc closes it.
  const drawerOpen = sidebarOpen && !isDesktop
  const showContext = rightPanelOpen && Boolean(noteId)
  const sheetOpen = showContext && !isDesktop

  useEffect(() => {
    // Wait for the folder index to resolve the note's owning workspace, including subfolders.
    if (user && note && !note.deleted_at && folders)
      rememberNote(user.id, note.id, activeWorkspaceId)
  }, [user, note, folders, activeWorkspaceId])

  function workspaceDestination(folder: WorkspaceFolder) {
    const id = lastNote(user?.id, folder.id)
    const last = id && notes?.find((entry) => entry.id === id)
    return last && workspaceMap.get(last.folder_id ?? '')?.id === folder.id
      ? '/notes/' + last.id
      : workspacePath(folder.id)
  }

  const workspaceItems = [
    { label: 'Browse workspaces', icon: Folder, onSelect: () => navigate('/notes') },
    { label: 'Inbox', icon: Inbox, onSelect: () => navigate('/notes?view=inbox') },
    ...(activeWorkspace
      ? [
          {
            label: 'Workspace overview',
            onSelect: () => navigate(workspacePath(activeWorkspace.id)),
          },
        ]
      : []),
    ...workspaces.map((folder) => ({
      key: folder.id,
      label: folder.name,
      icon: Folder,
      onSelect: () => navigate(workspaceDestination(folder)),
    })),
  ]

  useEffect(() => {
    if (!drawerOpen && !sheetOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (drawerOpen) toggleSidebar()
      else if (sheetOpen) toggleRightPanel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen, sheetOpen, toggleSidebar, toggleRightPanel])

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

  useEffect(() => prefetchCommonPages(), [])

  // Selecting a note/list on mobile should close the drawer it was picked from, the same
  // way a native app's nav drawer behaves — without this the destination renders behind
  // the still-open sidebar.
  useEffect(() => {
    if (window.innerWidth < 768 && useUIStore.getState().sidebarOpen) toggleSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on navigation, not on every sidebarOpen/toggleSidebar identity change
  }, [location.pathname, location.search])

  const items =
    user?.role === 'admin'
      ? [...navItems, { to: '/admin', label: 'Admin', icon: Shield }]
      : navItems

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-text">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-(--overlay) md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}
      <aside
        data-open={sidebarOpen || undefined}
        inert={!sidebarOpen}
        aria-label="Sidebar"
        className={clsx(
          'ui-sidebar fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-surface',
          'transition-transform duration-150 md:relative md:inset-auto md:transition-[width]',
          sidebarOpen
            ? 'translate-x-0 md:m-4 md:border'
            : '-translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden md:border-r-0',
        )}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <span className="ui-wordmark font-serif text-base">{APP_NAME}</span>
          <IconButton label="Collapse sidebar" onClick={toggleSidebar} className="max-md:hidden">
            <PanelLeft size={16} strokeWidth={1.5} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          <nav aria-label="Workspace navigation" className="grid gap-0.5">
            <NavLink to="/tasks/today" className={workspaceNav}>
              <Sun size={16} /> Today
            </NavLink>
            <NavLink to="/tasks/all" className={workspaceNav}>
              <ListTodo size={16} /> All tasks
            </NavLink>
            <Link
              to="/notes"
              aria-current={location.pathname === '/notes' && !inbox ? 'page' : undefined}
              className={clsx(workspaceNav, 'mt-3')}
            >
              <Folder size={16} /> Workspaces
            </Link>
            {workspaces.map((folder) => (
              <Link
                key={folder.id}
                to={workspaceDestination(folder)}
                data-active={folder.id === activeWorkspaceId}
                className={clsx(workspaceNav, 'pl-4')}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-accent/65" />
                <span className="truncate">{folder.name}</span>
              </Link>
            ))}
            <Link
              to="/notes?view=inbox"
              aria-current={inbox ? 'page' : undefined}
              className={workspaceNav}
            >
              <Inbox size={16} /> Inbox
            </Link>
          </nav>
          {tasksSection && (
            <details
              className="mt-3 border-t border-border py-2"
              open={Boolean(listId) || undefined}
            >
              <summary className="cursor-pointer px-2 py-2 text-sm text-text-muted hover:text-text">
                Task lists & calendar
              </summary>
              <TaskListSidebar />
            </details>
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
                      'ui-nav-item flex items-center gap-2.5 px-2.5 py-1.5 text-sm transition-colors duration-150',
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
                  className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-sm text-text hover:bg-surface-raised"
                >
                  <span className="truncate">{user.username}</span>
                  <ChevronsUpDown size={14} strokeWidth={1.5} className="text-text-muted" />
                </button>
              }
              items={[{ label: 'Log out', onSelect: () => logout.mutate() }]}
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-3 py-3">
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col" inert={drawerOpen || sheetOpen}>
        <header className="ui-topbar flex min-h-14 shrink-0 items-center gap-1 border-b border-border px-2 sm:gap-2 sm:px-3">
          <IconButton
            label="Open menu"
            onClick={toggleSidebar}
            className={sidebarOpen ? 'md:hidden' : 'inline-flex'}
          >
            <Menu size={18} strokeWidth={1.5} />
          </IconButton>
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label="Switch workspace"
                className="ui-nav-item flex min-h-10 min-w-0 items-center gap-2 bg-surface px-3 text-sm font-semibold"
              >
                <span className="truncate">
                  {activeWorkspace?.name ?? (inbox ? 'Inbox' : 'All workspaces')}
                </span>
                <ChevronsUpDown size={14} />
              </button>
            }
            items={workspaceItems}
          />
          {activeWorkspace && (noteId || listId) && (
            <Link
              to={workspacePath(activeWorkspace.id)}
              className="ui-nav-item hidden px-3 py-2 text-sm text-text-muted sm:inline-flex"
            >
              Overview
            </Link>
          )}
          <span className="flex-1" />
          <Tooltip label="Command palette (Ctrl/Cmd+K)">
            <IconButton label="Open command palette" onClick={() => setCommandPaletteOpen(true)}>
              <Search size={16} strokeWidth={1.5} />
            </IconButton>
          </Tooltip>
          <FilesDrawer key={location.pathname} workspaceId={activeWorkspaceId} />
          {noteId && (
            <IconButton
              label="Toggle context panel"
              onClick={toggleRightPanel}
              active={showContext}
            >
              <PanelRight size={16} strokeWidth={1.5} />
            </IconButton>
          )}
        </header>

        <ConnectionBanner />

        {user?.telegram_blocked && (
          <div className="flex shrink-0 items-center gap-2.5 border-b border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <TriangleAlert size={15} strokeWidth={1.5} className="shrink-0" />
            <span className="flex-1">
              {APP_NAME} can't send Telegram reminders — you've blocked the bot.
            </span>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="shrink-0 underline underline-offset-2 hover:opacity-80"
            >
              Unblock in Telegram
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-y-auto">
            <Outlet />
          </main>

          <aside
            className={clsx(
              'hidden shrink-0 flex-col border-l border-border bg-surface transition-[width] duration-150 md:flex',
              showContext ? 'w-72' : 'w-0 overflow-hidden',
            )}
          >
            {showContext && isDesktop && <ContextPanelContent noteId={noteId} />}
          </aside>
        </div>
      </div>

      {showContext && (
        <div
          className="fixed inset-0 z-30 bg-(--overlay) md:hidden"
          onClick={toggleRightPanel}
          aria-hidden="true"
        />
      )}
      <div
        className={clsx(
          'fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col border-t border-border bg-surface',
          'transition-transform duration-150 md:hidden',
          showContext ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <div className="flex justify-center pt-2">
          <div className="h-1 w-10 bg-border" />
        </div>
        {/* Only one copy of the panel is ever mounted (its graph/backlink queries aren't
            free), and only while it's actually open. */}
        {showContext && !isDesktop && <ContextPanelContent noteId={noteId} />}
      </div>

      <CommandPalette workspace={activeWorkspace} workspaceAssignments={workspaceMap} />
    </div>
  )
}

function ContextPanelContent({ noteId }: { noteId?: string }) {
  return (
    <>
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
    </>
  )
}

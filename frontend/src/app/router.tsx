import type { ComponentType } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { FileText } from '@/design/icons'
import { AppShell } from '@/features/shell/AppShell'
import { PlaceholderPage } from '@/features/shell/PlaceholderPage'
import LoginPage from '@/features/auth/LoginPage'
import InviteAcceptPage from '@/features/auth/InviteAcceptPage'
import { RequireAdmin, RequireAuth } from '@/features/auth/RequireAuth'
import TodayView from '@/features/tasks/TodayView'
import UpcomingView from '@/features/tasks/UpcomingView'
import ListView from '@/features/tasks/ListView'
import { RouteError } from '@/app/RouteError'

/** Route-level code splitting: each heavier page (the CodeMirror editor, the graph,
 * the calendar, settings/admin…) is its own chunk, fetched on first visit instead of
 * being part of the initial bundle. */
function page(load: () => Promise<{ default: ComponentType }>) {
  return async () => ({ Component: (await load()).default })
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/invite/:token', element: <InviteAcceptPage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
    // Shown while a lazily loaded page's code arrives on a direct visit or reload.
    hydrateFallbackElement: <p className="p-6 text-sm text-text-muted">Loading…</p>,
    children: [
      {
        path: '/',
        element: <AppShell />,
        errorElement: <RouteError />,
        children: [
          {
            index: true,
            element: <PlaceholderPage icon={FileText} title="Select or create a note" />,
          },
          {
            path: 'notes',
            element: <PlaceholderPage icon={FileText} title="Select or create a note" />,
          },
          { path: 'notes/:noteId', lazy: page(() => import('@/features/notes/NoteEditorRoute')) },
          { path: 'tags/:name', lazy: page(() => import('@/features/notes/TagNotesPage')) },
          { path: 'tasks', element: <Navigate to="/tasks/today" replace /> },
          { path: 'tasks/today', element: <TodayView /> },
          { path: 'tasks/upcoming', element: <UpcomingView /> },
          { path: 'tasks/list/:listId', element: <ListView /> },
          { path: 'tasks/calendar', lazy: page(() => import('@/features/tasks/CalendarPage')) },
          { path: 'graph', lazy: page(() => import('@/features/graph/GraphPage')) },
          { path: 'search', lazy: page(() => import('@/features/search/SearchPage')) },
          {
            path: 'attachments',
            lazy: page(() => import('@/features/attachments/AttachmentsPage')),
          },
          { path: 'trash', lazy: page(() => import('@/features/notes/TrashPage')) },
          { path: 'settings', lazy: page(() => import('@/features/settings/SettingsPage')) },
          {
            path: '*',
            element: <PlaceholderPage icon={FileText} title="This page doesn't exist" />,
          },
          {
            element: <RequireAdmin />,
            children: [{ path: 'admin', lazy: page(() => import('@/features/admin/AdminPage')) }],
          },
          ...(import.meta.env.DEV
            ? [
                {
                  path: 'styleguide',
                  lazy: page(() => import('@/features/styleguide/StyleguidePage')),
                },
              ]
            : []),
        ],
      },
    ],
  },
])

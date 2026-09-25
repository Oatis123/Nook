import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { FileText } from '@/design/icons'
import { AppShell } from '@/features/shell/AppShell'
import { PlaceholderPage } from '@/features/shell/PlaceholderPage'
import LoginPage from '@/features/auth/LoginPage'
import InviteAcceptPage from '@/features/auth/InviteAcceptPage'
import { RequireAdmin, RequireAuth } from '@/features/auth/RequireAuth'
import SettingsPage from '@/features/settings/SettingsPage'
import AdminPage from '@/features/admin/AdminPage'
import NoteEditorRoute from '@/features/notes/NoteEditorRoute'
import TrashPage from '@/features/notes/TrashPage'
import TagNotesPage from '@/features/notes/TagNotesPage'
import SearchPage from '@/features/search/SearchPage'
import AttachmentsPage from '@/features/attachments/AttachmentsPage'
import GraphPage from '@/features/graph/GraphPage'
import TodayView from '@/features/tasks/TodayView'
import UpcomingView from '@/features/tasks/UpcomingView'
import ListView from '@/features/tasks/ListView'
import CalendarPage from '@/features/tasks/CalendarPage'
import { RouteError } from '@/app/RouteError'

const StyleguidePage = lazy(() => import('@/features/styleguide/StyleguidePage'))

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/invite/:token', element: <InviteAcceptPage />, errorElement: <RouteError /> },
  {
    element: <RequireAuth />,
    errorElement: <RouteError />,
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
          { path: 'notes/:noteId', element: <NoteEditorRoute /> },
          { path: 'tags/:name', element: <TagNotesPage /> },
          { path: 'tasks', element: <Navigate to="/tasks/today" replace /> },
          { path: 'tasks/today', element: <TodayView /> },
          { path: 'tasks/upcoming', element: <UpcomingView /> },
          { path: 'tasks/list/:listId', element: <ListView /> },
          { path: 'tasks/calendar', element: <CalendarPage /> },
          { path: 'graph', element: <GraphPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'attachments', element: <AttachmentsPage /> },
          { path: 'trash', element: <TrashPage /> },
          { path: 'settings', element: <SettingsPage /> },
          {
            path: '*',
            element: <PlaceholderPage icon={FileText} title="This page doesn't exist" />,
          },
          {
            element: <RequireAdmin />,
            children: [{ path: 'admin', element: <AdminPage /> }],
          },
          ...(import.meta.env.DEV
            ? [
                {
                  path: 'styleguide',
                  element: (
                    <Suspense fallback={null}>
                      <StyleguidePage />
                    </Suspense>
                  ),
                },
              ]
            : []),
        ],
      },
    ],
  },
])

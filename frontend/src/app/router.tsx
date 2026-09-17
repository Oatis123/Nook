import { lazy, Suspense } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import { FileText, ListTodo, Network, Search } from 'lucide-react'
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

const StyleguidePage = lazy(() => import('@/features/styleguide/StyleguidePage'))

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InviteAcceptPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppShell />,
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
          {
            path: 'tasks',
            element: <PlaceholderPage icon={ListTodo} title="Tasks are coming soon" />,
          },
          {
            path: 'graph',
            element: <PlaceholderPage icon={Network} title="The graph is coming soon" />,
          },
          {
            path: 'search',
            element: <PlaceholderPage icon={Search} title="Search is coming soon" />,
          },
          { path: 'trash', element: <TrashPage /> },
          { path: 'settings', element: <SettingsPage /> },
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

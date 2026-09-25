import { Tabs } from '@/design/components/Tabs'
import { InvitesPanel } from '@/features/admin/InvitesPanel'
import { UsersPanel } from '@/features/admin/UsersPanel'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function AdminPage() {
  useDocumentTitle('Admin')
  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="mb-6 font-serif text-2xl text-text">Admin</h1>
      <Tabs
        items={[
          { value: 'invites', label: 'Invites', content: <InvitesPanel /> },
          { value: 'users', label: 'Users', content: <UsersPanel /> },
        ]}
      />
    </div>
  )
}

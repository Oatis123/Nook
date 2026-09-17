import { Tabs } from '@/design/components/Tabs'
import { InvitesPanel } from '@/features/admin/InvitesPanel'
import { UsersPanel } from '@/features/admin/UsersPanel'

export default function AdminPage() {
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

import { useState } from 'react'
import { clsx } from 'clsx'
import { DropdownMenu, type DropdownMenuItem } from '@/design/components/DropdownMenu'
import { IconButton } from '@/design/components/IconButton'
import { Dialog } from '@/design/components/Dialog'
import { MoreHorizontal, Copy } from 'lucide-react'
import type { User } from '@/lib/types'
import { formatDate as formatDateString } from '@/lib/format'
import {
  useActivateUser,
  useDeactivateUser,
  useResetPassword,
  useSetUserRole,
  useUnlinkTelegram,
  useUsers,
} from '@/features/admin/hooks'

function formatDate(iso: string | null) {
  return iso ? formatDateString(iso) : '—'
}

export function UsersPanel() {
  const users = useUsers()
  const activate = useActivateUser()
  const deactivate = useDeactivateUser()
  const unlinkTelegram = useUnlinkTelegram()
  const setRole = useSetUserRole()
  const resetPassword = useResetPassword()
  const [resetLink, setResetLink] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-4">
      {users.data && (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted">
              <th className="py-2 font-normal">Username</th>
              <th className="py-2 font-normal">Role</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal">Telegram</th>
              <th className="py-2 font-normal">Registered</th>
              <th className="py-2 font-normal">Last login</th>
              <th className="py-2 font-normal" />
            </tr>
          </thead>
          <tbody>
            {users.data.map((user: User) => {
              const items: DropdownMenuItem[] = [
                user.is_active
                  ? { label: 'Deactivate', onSelect: () => deactivate.mutate(user.id) }
                  : { label: 'Activate', onSelect: () => activate.mutate(user.id) },
                user.role === 'admin'
                  ? {
                      label: 'Remove admin role',
                      onSelect: () => setRole.mutate({ id: user.id, role: 'user' }),
                    }
                  : {
                      label: 'Make admin',
                      onSelect: () => setRole.mutate({ id: user.id, role: 'admin' }),
                    },
                {
                  label: 'Unlink Telegram',
                  disabled: !user.telegram_linked,
                  onSelect: () => unlinkTelegram.mutate(user.id),
                },
                {
                  label: 'Reset password',
                  onSelect: () =>
                    resetPassword.mutate(user.id, {
                      onSuccess: (result) => setResetLink(result.reset_url),
                    }),
                },
              ]

              return (
                <tr key={user.id} className="border-b border-border last:border-b-0">
                  <td className="py-2.5">{user.username}</td>
                  <td className="py-2.5 capitalize text-text-muted">{user.role}</td>
                  <td
                    className={clsx(
                      'py-2.5',
                      user.is_active ? 'text-priority-low' : 'text-text-muted',
                    )}
                  >
                    {user.is_active ? 'Active' : 'Inactive'}
                  </td>
                  <td className="py-2.5 text-text-muted">
                    {user.telegram_linked ? 'Linked' : '—'}
                  </td>
                  <td className="py-2.5 text-text-muted">{formatDate(user.created_at)}</td>
                  <td className="py-2.5 text-text-muted">{formatDate(user.last_login_at)}</td>
                  <td className="py-2.5 text-right">
                    <DropdownMenu
                      items={items}
                      trigger={
                        <IconButton label={`Actions for ${user.username}`}>
                          <MoreHorizontal size={16} strokeWidth={1.5} />
                        </IconButton>
                      }
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <Dialog
        open={resetLink !== null}
        onOpenChange={(open) => !open && setResetLink(null)}
        title="Password reset link"
        description="Share this one-time link with the user. It expires after use."
      >
        <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
          <span className="flex-1 truncate text-sm">{resetLink}</span>
          <button
            type="button"
            aria-label="Copy reset link"
            onClick={() => resetLink && navigator.clipboard.writeText(resetLink)}
            className="text-text-muted hover:text-text"
          >
            <Copy size={15} strokeWidth={1.5} />
          </button>
        </div>
      </Dialog>
    </div>
  )
}

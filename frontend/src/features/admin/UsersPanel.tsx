import { useState } from 'react'
import { clsx } from 'clsx'
import { DropdownMenu, type DropdownMenuItem } from '@/design/components/DropdownMenu'
import { IconButton } from '@/design/components/IconButton'
import { Dialog } from '@/design/components/Dialog'
import { MoreHorizontal } from '@/design/icons'
import type { User } from '@/lib/types'
import { formatDate as formatDateString } from '@/lib/format'
import { CopyField } from '@/design/components/CopyField'
import { QueryState } from '@/design/components/QueryState'
import { useCurrentUser } from '@/features/auth/hooks'
import { confirmAction } from '@/lib/confirm'
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
  const { data: me } = useCurrentUser()

  async function confirmThen(
    options: Parameters<typeof confirmAction>[0],
    action: () => void,
  ): Promise<void> {
    if (await confirmAction(options)) action()
  }

  return (
    <div className="flex flex-col gap-4">
      {!users.data && <QueryState query={users} compact />}
      {users.data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
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
                    ? {
                        label: 'Deactivate',
                        danger: true,
                        onSelect: () =>
                          confirmThen(
                            {
                              title: `Deactivate ${user.username}?`,
                              description: 'They are signed out and can no longer sign in.',
                              confirmLabel: 'Deactivate',
                              danger: true,
                            },
                            () => deactivate.mutate(user.id),
                          ),
                      }
                    : { label: 'Activate', onSelect: () => activate.mutate(user.id) },
                  user.role === 'admin'
                    ? {
                        label: 'Remove admin role',
                        onSelect: () =>
                          confirmThen(
                            {
                              title:
                                user.id === me?.id
                                  ? 'Remove your own admin role?'
                                  : `Remove admin role from ${user.username}?`,
                              description:
                                user.id === me?.id
                                  ? 'You lose access to this admin panel immediately; only another admin can give it back.'
                                  : 'They lose access to the admin panel.',
                              confirmLabel: 'Remove admin role',
                              danger: true,
                            },
                            () => setRole.mutate({ id: user.id, role: 'user' }),
                          ),
                      }
                    : {
                        label: 'Make admin',
                        onSelect: () =>
                          confirmThen(
                            {
                              title: `Make ${user.username} an admin?`,
                              description:
                                'Admins can manage users and invites, including other admins.',
                              confirmLabel: 'Make admin',
                            },
                            () => setRole.mutate({ id: user.id, role: 'admin' }),
                          ),
                      },
                  {
                    label: 'Unlink Telegram',
                    disabled: !user.telegram_linked,
                    onSelect: () =>
                      confirmThen(
                        {
                          title: `Unlink ${user.username}'s Telegram?`,
                          description:
                            'Reminders stop and they have to link Telegram again before using the app.',
                          confirmLabel: 'Unlink',
                          danger: true,
                        },
                        () => unlinkTelegram.mutate(user.id),
                      ),
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
        </div>
      )}

      <Dialog
        open={resetLink !== null}
        onOpenChange={(open) => !open && setResetLink(null)}
        title="Password reset link"
        description="Share this one-time link with the user. It expires after use."
      >
        {resetLink && <CopyField value={resetLink} label="Reset link" />}
      </Dialog>
    </div>
  )
}

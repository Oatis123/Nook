import { type FormEvent, useState } from 'react'
import { Copy, Mail, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { EmptyState } from '@/design/components/EmptyState'
import type { Invite, InviteStatus } from '@/lib/types'
import { formatDate } from '@/lib/format'
import { useCreateInvite, useInvites, useRevokeInvite } from '@/features/admin/hooks'

const STATUS_STYLES: Record<InviteStatus, string> = {
  active: 'text-priority-low',
  used: 'text-text-muted',
  expired: 'text-text-muted',
  revoked: 'text-danger',
}

function NewInviteDialog() {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [expiresInDays, setExpiresInDays] = useState('7')
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const createInvite = useCreateInvite()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    createInvite.mutate(
      {
        comment: comment.trim() || null,
        expires_in_days: expiresInDays ? Number(expiresInDays) : null,
      },
      { onSuccess: (invite) => setCreatedUrl(invite.invite_url) },
    )
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setComment('')
      setExpiresInDays('7')
      setCreatedUrl(null)
      createInvite.reset()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant="primary">
          <Plus size={16} strokeWidth={1.5} />
          New invite
        </Button>
      }
      title="New invite"
      description="One-time link, valid until used or expired."
    >
      {createdUrl ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            Share this link with the person you're inviting. It's shown only once.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <span className="flex-1 truncate text-sm">{createdUrl}</span>
            <button
              type="button"
              aria-label="Copy invite link"
              onClick={() => navigator.clipboard.writeText(createdUrl)}
              className="text-text-muted hover:text-text"
            >
              <Copy size={15} strokeWidth={1.5} />
            </button>
          </div>
          <Button variant="secondary" onClick={() => handleOpenChange(false)}>
            Done
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="comment" className="text-sm text-text-muted">
              Comment (optional)
            </label>
            <input
              id="comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="expires" className="text-sm text-text-muted">
              Expires in (days)
            </label>
            <input
              id="expires"
              type="number"
              min={1}
              max={365}
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value)}
              className="h-9 w-24 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
            />
          </div>
          <Button type="submit" variant="primary" disabled={createInvite.isPending}>
            {createInvite.isPending ? 'Creating…' : 'Create invite'}
          </Button>
        </form>
      )}
    </Dialog>
  )
}

export function InvitesPanel() {
  const invites = useInvites()
  const revokeInvite = useRevokeInvite()

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <NewInviteDialog />
      </div>

      {invites.data?.length === 0 && (
        <EmptyState icon={Mail} title="No invites yet. Create one to add a person." />
      )}

      {invites.data && invites.data.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted">
                <th className="py-2 font-normal">Comment</th>
                <th className="py-2 font-normal">Status</th>
                <th className="py-2 font-normal">Used by</th>
                <th className="py-2 font-normal">Expires</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {invites.data.map((invite: Invite) => (
                <tr key={invite.id} className="border-b border-border last:border-b-0">
                  <td className="py-2.5">{invite.comment || '—'}</td>
                  <td className={clsx('py-2.5 capitalize', STATUS_STYLES[invite.status])}>
                    {invite.status}
                  </td>
                  <td className="py-2.5">{invite.used_by_username || '—'}</td>
                  <td className="py-2.5 text-text-muted">{formatDate(invite.expires_at)}</td>
                  <td className="py-2.5 text-right">
                    {invite.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => revokeInvite.mutate(invite.id)}
                        className="text-text-muted hover:text-danger"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

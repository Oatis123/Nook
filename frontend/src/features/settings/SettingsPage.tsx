import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Download, Upload } from 'lucide-react'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { ApiError } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import {
  useChangePassword,
  useCurrentUser,
  useRevokeAllSessions,
  useRevokeSession,
  useSessions,
  useUnlinkTelegram,
  useUpdateProfile,
} from '@/features/auth/hooks'
import { useImportJob, useUploadVaultImport } from '@/features/notes/hooks'
import { vaultExportUrl } from '@/features/notes/api'

function timezoneOptions(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return [Intl.DateTimeFormat().resolvedOptions().timeZone]
  }
}

function ProfileSection() {
  const { data: user } = useCurrentUser()
  const updateProfile = useUpdateProfile()

  if (!user) return null

  return (
    <section className="border-b border-border py-8 first:pt-0">
      <h2 className="mb-4 font-serif text-lg text-text">Profile</h2>
      <div className="flex flex-col gap-1.5 max-w-xs">
        <label htmlFor="timezone" className="text-sm text-text-muted">
          Timezone
        </label>
        <select
          id="timezone"
          value={user.timezone}
          onChange={(e) => updateProfile.mutate({ timezone: e.target.value })}
          className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
        >
          {timezoneOptions().map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>
    </section>
  )
}

function TelegramSection() {
  const { data: user } = useCurrentUser()
  const unlink = useUnlinkTelegram()
  const [open, setOpen] = useState(false)

  if (!user) return null

  return (
    <section className="border-b border-border py-8">
      <h2 className="mb-4 font-serif text-lg text-text">Telegram</h2>
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {user.telegram_linked ? 'Connected.' : 'Not connected.'}
        </p>
        <Dialog
          open={open}
          onOpenChange={setOpen}
          trigger={<Button variant="secondary">Disconnect</Button>}
          title="Disconnect Telegram"
          description="You'll be asked to reconnect before you can use the app again."
        >
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={unlink.isPending}
              onClick={() => unlink.mutate(undefined, { onSuccess: () => setOpen(false) })}
            >
              Disconnect
            </Button>
          </div>
        </Dialog>
      </div>
    </section>
  )
}

function VaultSection() {
  const queryClient = useQueryClient()
  const uploadImport = useUploadVaultImport()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const importJob = useImportJob(jobId)
  const status = importJob.data?.status

  useEffect(() => {
    if (status !== 'done' && status !== 'failed') return
    queryClient.invalidateQueries({ queryKey: ['notes'] })
    queryClient.invalidateQueries({ queryKey: ['folders'] })
    queryClient.invalidateQueries({ queryKey: ['tags'] })
    queryClient.invalidateQueries({ queryKey: ['attachments'] })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the job's status itself changes, not on every queryClient identity
  }, [status])

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setJobId(null)
    uploadImport.mutate(file, { onSuccess: (job) => setJobId(job.id) })
  }

  const report = importJob.data?.report

  return (
    <section className="border-b border-border py-8">
      <h2 className="mb-4 font-serif text-lg text-text">Obsidian vault</h2>
      <div className="flex flex-col gap-4 max-w-sm">
        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">Export everything as a .zip.</p>
          <a href={vaultExportUrl()} download className="inline-flex">
            <Button variant="secondary">
              <Download size={14} strokeWidth={1.5} />
              Export vault
            </Button>
          </a>
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm text-text-muted">Import a vault from a .zip.</p>
          <Button
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadImport.isPending || status === 'pending' || status === 'processing'}
          >
            <Upload size={14} strokeWidth={1.5} />
            Import vault
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            aria-label="Import vault"
            onChange={handleFileChange}
          />
        </div>

        {(status === 'pending' || status === 'processing') && (
          <p className="text-sm text-text-muted">Importing…</p>
        )}

        {status === 'done' && report && (
          <div className="rounded-md border border-border bg-surface px-3 py-2 text-sm">
            <p className="text-text">
              Imported {report.notes_imported} note{report.notes_imported === 1 ? '' : 's'} and{' '}
              {report.attachments_imported} attachment{report.attachments_imported === 1 ? '' : 's'}
              .
            </p>
            {report.conflicts.length > 0 && (
              <p className="mt-1 text-text-muted">
                {report.conflicts.length} title conflict(s) renamed.
              </p>
            )}
            {report.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-4 text-danger">
                {report.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {status === 'failed' && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            Import failed.
            {report?.errors.map((err, i) => (
              <div key={i}>{err}</div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function PasswordSection() {
  const changePassword = useChangePassword()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword('')
          setNewPassword('')
        },
      },
    )
  }

  return (
    <section className="border-b border-border py-8">
      <h2 className="mb-4 font-serif text-lg text-text">Password</h2>
      <form onSubmit={handleSubmit} className="flex max-w-xs flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="current-password" className="text-sm text-text-muted">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="new-password" className="text-sm text-text-muted">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
          />
        </div>

        {changePassword.isError && (
          <p role="alert" className="text-sm text-danger">
            {changePassword.error instanceof ApiError
              ? changePassword.error.message
              : 'Something went wrong.'}
          </p>
        )}
        {changePassword.isSuccess && <p className="text-sm text-priority-low">Password updated.</p>}

        <Button type="submit" variant="secondary" disabled={changePassword.isPending}>
          {changePassword.isPending ? 'Updating…' : 'Update password'}
        </Button>
      </form>
    </section>
  )
}

function SessionsSection() {
  const sessions = useSessions()
  const revokeSession = useRevokeSession()
  const revokeAll = useRevokeAllSessions()

  return (
    <section className="py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-lg text-text">Active sessions</h2>
        {(sessions.data?.length ?? 0) > 1 && (
          <button
            type="button"
            onClick={() => revokeAll.mutate()}
            className="text-sm text-danger hover:underline"
          >
            Log out everywhere
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-2">
        {sessions.data?.map((session) => (
          <li
            key={session.id}
            className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm"
          >
            <div>
              <div className="text-text">
                {session.user_agent || 'Unknown device'}
                {session.is_current && (
                  <span className="ml-2 text-xs text-text-muted">(this device)</span>
                )}
              </div>
              <div className="text-xs text-text-muted">
                {session.ip} · since {formatDateTime(session.created_at)}
              </div>
            </div>
            {!session.is_current && (
              <button
                type="button"
                onClick={() => revokeSession.mutate(session.id)}
                className="text-text-muted hover:text-danger"
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <h1 className="mb-2 font-serif text-2xl text-text">Settings</h1>
      <ProfileSection />
      <TelegramSection />
      <VaultSection />
      <PasswordSection />
      <SessionsSection />
    </div>
  )
}

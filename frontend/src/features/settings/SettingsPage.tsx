import { type FormEvent, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Copy, Download, Plus, Upload } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { ThemeSkinPicker } from '@/design/components/ThemeSkinPicker'
import { ThemeToggle } from '@/design/components/ThemeToggle'
import { ApiError } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import {
  useApiTokens,
  useChangePassword,
  useCreateApiToken,
  useCurrentUser,
  useRevokeAllSessions,
  useRevokeApiToken,
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

function AppearanceSection() {
  return (
    <section className="border-b border-border py-8 first:pt-0">
      <h2 className="mb-4 font-serif text-lg text-text">Appearance</h2>
      <div className="flex flex-col gap-5">
        <div>
          <p className="mb-2 text-sm text-text-muted">Theme</p>
          <ThemeSkinPicker />
        </div>
        <div>
          <p className="mb-2 text-sm text-text-muted">Mode</p>
          <ThemeToggle />
        </div>
      </div>
    </section>
  )
}

function ProfileSection() {
  const { data: user } = useCurrentUser()
  const updateProfile = useUpdateProfile()

  if (!user) return null

  return (
    <section className="border-b border-border py-8">
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
  const [password, setPassword] = useState('')

  if (!user) return null

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setPassword('')
      unlink.reset()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    unlink.mutate(password, { onSuccess: () => handleOpenChange(false) })
  }

  return (
    <section className="border-b border-border py-8">
      <h2 className="mb-4 font-serif text-lg text-text">Telegram</h2>
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-muted">
          {user.telegram_linked ? 'Connected.' : 'Not connected.'}
        </p>
        <Dialog
          open={open}
          onOpenChange={handleOpenChange}
          trigger={<Button variant="secondary">Disconnect</Button>}
          title="Disconnect Telegram"
          description="You'll be asked to reconnect before you can use the app again."
        >
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm text-text-muted">
              Current password
              <input
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
              />
            </label>
            {unlink.isError && (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(unlink.error)}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={unlink.isPending || !password}>
                Disconnect
              </Button>
            </div>
          </form>
        </Dialog>
      </div>
    </section>
  )
}

function NewApiTokenDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [createdToken, setCreatedToken] = useState<string | null>(null)
  const createToken = useCreateApiToken()

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    createToken.mutate(trimmed, { onSuccess: (token) => setCreatedToken(token.token) })
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next) {
      setName('')
      setCreatedToken(null)
      createToken.reset()
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant="primary">
          <Plus size={16} strokeWidth={1.5} />
          New token
        </Button>
      }
      title="New API token"
      description="Used to connect an MCP client, such as Claude, to your account."
    >
      {createdToken ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Copy this token now — it won't be shown again.</p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
            <span className="flex-1 truncate text-sm">{createdToken}</span>
            <button
              type="button"
              aria-label="Copy token"
              onClick={() => navigator.clipboard.writeText(createdToken)}
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
            <label htmlFor="token-name" className="text-sm text-text-muted">
              Name
            </label>
            <input
              id="token-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Desktop"
              className="h-9 rounded-md border border-border bg-surface-raised px-3 text-sm outline-none focus-visible:border-accent"
            />
          </div>
          <Button type="submit" variant="primary" disabled={!name.trim() || createToken.isPending}>
            {createToken.isPending ? 'Creating…' : 'Create token'}
          </Button>
        </form>
      )}
    </Dialog>
  )
}

function ApiTokensSection() {
  const tokens = useApiTokens()
  const revokeToken = useRevokeApiToken()
  const mcpUrl = `${window.location.origin}/mcp`

  return (
    <section className="border-b border-border py-8">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-serif text-lg text-text">API tokens</h2>
        <NewApiTokenDialog />
      </div>
      <p className="mb-4 text-sm text-text-muted">
        Connect an MCP client (Claude Desktop, Claude Code, ...) to your notes and tasks. Point it
        at <code className="rounded bg-surface px-1 py-0.5 text-xs text-text">{mcpUrl}</code> with
        one of the tokens below as a bearer token.
      </p>
      {(tokens.data?.length ?? 0) === 0 ? (
        <p className="text-sm text-text-muted">No tokens yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tokens.data?.map((token) => (
            <li
              key={token.id}
              className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              <div>
                <div className="text-text">{token.name}</div>
                <div className="text-xs text-text-muted">
                  Created {formatDateTime(token.created_at)}
                  {token.last_used_at && <> · last used {formatDateTime(token.last_used_at)}</>}
                </div>
              </div>
              <button
                type="button"
                onClick={() => revokeToken.mutate(token.id)}
                className="text-text-muted hover:text-danger"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
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
          {/* A button that navigates to the download (the response is an attachment, so
              the page stays) — not a button nested inside a link. */}
          <Button variant="secondary" onClick={() => window.location.assign(vaultExportUrl())}>
            <Download size={14} strokeWidth={1.5} />
            Export vault
          </Button>
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
      <AppearanceSection />
      <ProfileSection />
      <TelegramSection />
      <ApiTokensSection />
      <VaultSection />
      <PasswordSection />
      <SessionsSection />
    </div>
  )
}

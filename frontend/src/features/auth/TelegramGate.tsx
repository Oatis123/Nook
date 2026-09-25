import { useEffect } from 'react'
import { Send } from '@/design/icons'
import { APP_NAME } from '@/lib/env'
import { Button } from '@/design/components/Button'
import { QrCode } from '@/design/components/QrCode'
import { useCreateTelegramLinkToken, useCurrentUser, useLogout } from '@/features/auth/hooks'

/** Blocks the whole app until Telegram is connected — spec §5.1 step 4 / §5.2, and
 * applies to every account including admin. */
export function TelegramGate() {
  useCurrentUser({ poll: true })
  const createLinkToken = useCreateTelegramLinkToken()
  const logout = useLogout()

  useEffect(() => {
    createLinkToken.mutate()
    // Intentionally runs once on mount; after that a fresh link is requested when the
    // current one expires (below) or when the user asks for one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Links expire after a few minutes; replace an expired one automatically rather than
  // leaving a QR code on screen that the bot will reject.
  const expiresAt = createLinkToken.data?.expires_at
  useEffect(() => {
    if (!expiresAt) return
    const ms = new Date(expiresAt).getTime() - Date.now()
    const timer = setTimeout(() => createLinkToken.mutate(), Math.max(ms, 0) + 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a new link arrives
  }, [expiresAt])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-4 text-center">
      <Send size={28} strokeWidth={1.5} className="text-accent" />
      <div>
        <h1 className="mb-2 font-serif text-2xl text-text">Connect Telegram</h1>
        <p className="mx-auto max-w-sm text-sm text-text-muted">
          {APP_NAME} uses Telegram for reminders and quick task capture. Connect your account to
          continue — this is a one-time step.
        </p>
      </div>

      {createLinkToken.data && (
        <>
          <QrCode value={createLinkToken.data.deep_link_url} />
          <a
            href={createLinkToken.data.deep_link_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent hover:underline"
          >
            Open in Telegram
          </a>
          <button
            type="button"
            onClick={() => createLinkToken.mutate()}
            disabled={createLinkToken.isPending}
            className="text-xs text-text-muted hover:text-text disabled:opacity-50"
          >
            Link not working? Get a new one
          </button>
        </>
      )}

      {createLinkToken.isPending && !createLinkToken.data && (
        <div className="h-[200px] w-[200px] animate-pulse rounded-md bg-surface" />
      )}

      {createLinkToken.isError && (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm text-danger">Couldn't create a connection link.</p>
          <Button variant="secondary" onClick={() => createLinkToken.mutate()}>
            Try again
          </Button>
        </div>
      )}

      <button
        type="button"
        onClick={() => logout.mutate()}
        className="text-sm text-text-muted hover:text-text"
      >
        Log out
      </button>
    </div>
  )
}

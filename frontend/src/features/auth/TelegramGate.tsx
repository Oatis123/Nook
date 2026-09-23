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
    // Intentionally runs once on mount; a fresh token is requested only if the user
    // explicitly asks (link expires in a few minutes, see "Get a new link" below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        </>
      )}

      {createLinkToken.isPending && (
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

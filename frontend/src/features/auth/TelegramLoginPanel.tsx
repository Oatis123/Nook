import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from '@/design/icons'
import { Button } from '@/design/components/Button'
import { QrCode } from '@/design/components/QrCode'
import {
  meQueryKey,
  useCreateTelegramLoginToken,
  useTelegramLoginStatus,
} from '@/features/auth/hooks'

export function TelegramLoginPanel({ onBack }: { onBack: () => void }) {
  const queryClient = useQueryClient()
  const createToken = useCreateTelegramLoginToken()
  const [plainToken, setPlainToken] = useState<string | null>(null)
  const status = useTelegramLoginStatus(plainToken)

  function requestNewToken() {
    createToken.mutate(undefined, {
      onSuccess: (data) => {
        const token = data.deep_link_url.split('login_').pop() ?? null
        setPlainToken(token)
      },
    })
  }

  useEffect(() => {
    requestNewToken()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (status.data?.status === 'confirmed' && status.data.user) {
      queryClient.setQueryData(meQueryKey, status.data.user)
    }
  }, [status.data, queryClient])

  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 self-start text-sm text-text-muted hover:text-text"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        Back to password
      </button>

      <p className="text-sm text-text-muted">
        Scan with Telegram, or open the link on this device.
      </p>

      {createToken.data && (
        <>
          <QrCode value={createToken.data.deep_link_url} />
          <a
            href={createToken.data.deep_link_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-accent hover:underline"
          >
            Open in Telegram
          </a>
        </>
      )}

      {createToken.isPending && (
        <div className="h-[200px] w-[200px] animate-pulse rounded-md bg-surface" />
      )}

      {status.data?.status === 'denied' && (
        <p className="text-sm text-danger">Login was denied. Try again.</p>
      )}
      {status.data?.status === 'expired' && (
        <p className="text-sm text-danger">This link expired.</p>
      )}
      {(status.data?.status === 'denied' || status.data?.status === 'expired') && (
        <Button variant="secondary" onClick={requestNewToken}>
          Get a new link
        </Button>
      )}
    </div>
  )
}

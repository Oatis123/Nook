import { type FormEvent, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { APP_NAME } from '@/lib/env'
import { ApiError } from '@/lib/api'
import { Button } from '@/design/components/Button'
import { EmptyState } from '@/design/components/EmptyState'
import { AlertTriangle } from 'lucide-react'
import { useAcceptInvite, useInvitePreview } from '@/features/auth/hooks'

export default function InviteAcceptPage() {
  const { token = '' } = useParams<{ token: string }>()
  const preview = useInvitePreview(token)
  const accept = useAcceptInvite()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  if (accept.isSuccess) return <Navigate to="/" replace />

  if (preview.isLoading) return null

  if (preview.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
        <EmptyState icon={AlertTriangle} title="This invite link is invalid or has expired." />
      </div>
    )
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    accept.mutate({ token, username, password, timezone })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-serif text-2xl text-text">Welcome to {APP_NAME}</h1>
        <p className="mb-8 text-center text-sm text-text-muted">
          {preview.data?.comment || 'Create your account to get started.'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="username" className="text-sm text-text-muted">
              Username
            </label>
            <input
              id="username"
              autoFocus
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              pattern="[a-z0-9_]{3,32}"
              title="3-32 characters: lowercase letters, digits, underscore"
              required
              className="h-10 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm text-text-muted">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={10}
              required
              className="h-10 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
            />
            <span className="text-xs text-text-muted">At least 10 characters.</span>
          </div>

          {accept.isError && (
            <p role="alert" className="text-sm text-danger">
              {accept.error instanceof ApiError
                ? accept.error.message
                : 'Something went wrong. Please try again.'}
            </p>
          )}

          <Button type="submit" variant="primary" disabled={accept.isPending} className="mt-2">
            {accept.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </div>
    </div>
  )
}

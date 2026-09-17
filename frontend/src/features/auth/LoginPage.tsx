import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Send } from 'lucide-react'
import { APP_NAME } from '@/lib/env'
import { ApiError } from '@/lib/api'
import { Button } from '@/design/components/Button'
import { useCurrentUser, useLogin } from '@/features/auth/hooks'
import { TelegramLoginPanel } from '@/features/auth/TelegramLoginPanel'

export default function LoginPage() {
  const { data: user, isLoading: userLoading } = useCurrentUser()
  const login = useLogin()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showTelegram, setShowTelegram] = useState(false)

  if (!userLoading && user) return <Navigate to="/" replace />

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    login.mutate({ username, password })
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center font-serif text-2xl text-text">{APP_NAME}</h1>
        <p className="mb-8 text-center text-sm text-text-muted">
          {showTelegram ? 'Log in with Telegram' : 'Sign in to your account'}
        </p>

        {showTelegram ? (
          <TelegramLoginPanel onBack={() => setShowTelegram(false)} />
        ) : (
          <>
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
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-10 rounded-md border border-border bg-surface-raised px-3 text-sm text-text outline-none focus-visible:border-accent"
                />
              </div>

              {login.isError && (
                <p role="alert" className="text-sm text-danger">
                  {login.error instanceof ApiError
                    ? login.error.message
                    : 'Something went wrong. Please try again.'}
                </p>
              )}

              <Button type="submit" variant="primary" disabled={login.isPending} className="mt-2">
                {login.isPending ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            <Button
              variant="secondary"
              onClick={() => setShowTelegram(true)}
              className="mt-3 w-full"
            >
              <Send size={15} strokeWidth={1.5} />
              Log in with Telegram
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

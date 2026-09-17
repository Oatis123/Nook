import { Navigate, Outlet } from 'react-router-dom'
import { useCurrentUser } from '@/features/auth/hooks'
import { TelegramGate } from '@/features/auth/TelegramGate'

export function RequireAuth() {
  const { data: user, isLoading } = useCurrentUser()

  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (!user.telegram_linked) return <TelegramGate />

  return <Outlet />
}

export function RequireAdmin() {
  const { data: user, isLoading } = useCurrentUser()

  if (isLoading) return null
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') return <Navigate to="/" replace />

  return <Outlet />
}

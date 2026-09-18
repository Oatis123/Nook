import { apiFetch } from '@/lib/api'
import type {
  ApiToken,
  ApiTokenCreated,
  InvitePreview,
  Session,
  TelegramLoginStatusResult,
  TelegramToken,
  User,
} from '@/lib/types'

export const getMe = () => apiFetch<User>('/me')

export type MeUpdateInput = Partial<
  Pick<
    User,
    | 'timezone'
    | 'daily_reminder_time'
    | 'notifications_enabled'
    | 'theme'
    | 'editor_preview_enabled'
  >
>

export const updateMe = (patch: MeUpdateInput) =>
  apiFetch<User>('/me', { method: 'PATCH', body: patch })

export const login = (username: string, password: string) =>
  apiFetch<User>('/auth/login', { method: 'POST', body: { username, password } })

export const logout = () => apiFetch<void>('/auth/logout', { method: 'POST' })

export const previewInvite = (token: string) =>
  apiFetch<InvitePreview>(`/auth/invite/${encodeURIComponent(token)}`)

export const acceptInvite = (input: {
  token: string
  username: string
  password: string
  timezone: string
}) => apiFetch<User>('/auth/invite/accept', { method: 'POST', body: input })

export const getSessions = () => apiFetch<Session[]>('/auth/sessions')

export const revokeSession = (id: string) =>
  apiFetch<void>(`/auth/sessions/${id}`, { method: 'DELETE' })

export const revokeAllSessions = () => apiFetch<void>('/auth/sessions', { method: 'DELETE' })

export const getApiTokens = () => apiFetch<ApiToken[]>('/me/api-tokens')

export const createApiToken = (name: string) =>
  apiFetch<ApiTokenCreated>('/me/api-tokens', { method: 'POST', body: { name } })

export const revokeApiToken = (id: string) =>
  apiFetch<void>(`/me/api-tokens/${id}`, { method: 'DELETE' })

export const changePassword = (currentPassword: string, newPassword: string) =>
  apiFetch<void>('/me/password', {
    method: 'POST',
    body: { current_password: currentPassword, new_password: newPassword },
  })

export const consumePasswordReset = (token: string, newPassword: string) =>
  apiFetch<void>(`/auth/password-reset/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: { new_password: newPassword },
  })

export const createTelegramLinkToken = () =>
  apiFetch<TelegramToken>('/me/telegram/link-token', { method: 'POST' })

export const unlinkTelegram = () => apiFetch<User>('/me/telegram/unlink', { method: 'POST' })

export const createTelegramLoginToken = () =>
  apiFetch<TelegramToken>('/auth/telegram/login-token', { method: 'POST' })

export const checkTelegramLoginStatus = (token: string) =>
  apiFetch<TelegramLoginStatusResult>('/auth/telegram/login-status', {
    method: 'POST',
    body: { token },
  })

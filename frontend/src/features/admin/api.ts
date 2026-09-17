import { apiFetch } from '@/lib/api'
import type { Invite, InviteCreateResult, User, UserRole } from '@/lib/types'

export const listInvites = () => apiFetch<Invite[]>('/admin/invites')

export const createInvite = (input: { comment: string | null; expires_in_days: number | null }) =>
  apiFetch<InviteCreateResult>('/admin/invites', { method: 'POST', body: input })

export const revokeInvite = (id: string) =>
  apiFetch<Invite>(`/admin/invites/${id}/revoke`, { method: 'POST' })

export const listUsers = () => apiFetch<User[]>('/admin/users')

export const activateUser = (id: string) =>
  apiFetch<User>(`/admin/users/${id}/activate`, { method: 'POST' })

export const deactivateUser = (id: string) =>
  apiFetch<User>(`/admin/users/${id}/deactivate`, { method: 'POST' })

export const unlinkTelegram = (id: string) =>
  apiFetch<User>(`/admin/users/${id}/unlink-telegram`, { method: 'POST' })

export const setUserRole = (id: string, role: UserRole) =>
  apiFetch<User>(`/admin/users/${id}/role`, { method: 'POST', body: { role } })

export const resetPassword = (id: string) =>
  apiFetch<{ reset_url: string }>(`/admin/users/${id}/reset-password`, { method: 'POST' })

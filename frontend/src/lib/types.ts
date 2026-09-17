export type UserRole = 'admin' | 'user'
export type Theme = 'light' | 'dark' | 'system'

export interface User {
  id: string
  username: string
  role: UserRole
  is_active: boolean
  timezone: string
  daily_reminder_time: string
  notifications_enabled: boolean
  theme: Theme
  editor_preview_enabled: boolean
  telegram_linked: boolean
  telegram_blocked: boolean
  created_at: string
  last_login_at: string | null
}

export interface Session {
  id: string
  user_agent: string | null
  ip: string | null
  created_at: string
  expires_at: string
  is_current: boolean
}

export type InviteStatus = 'active' | 'used' | 'expired' | 'revoked'

export interface Invite {
  id: string
  comment: string | null
  status: InviteStatus
  expires_at: string
  used_by_username: string | null
  used_at: string | null
  revoked_at: string | null
  created_at: string
}

export interface InviteCreateResult extends Invite {
  invite_url: string
}

export interface InvitePreview {
  comment: string | null
  expires_at: string
}

export interface TelegramToken {
  deep_link_url: string
  expires_at: string
}

export type TelegramLoginStatus = 'pending' | 'confirmed' | 'denied' | 'expired'

export interface TelegramLoginStatusResult {
  status: TelegramLoginStatus
  user: User | null
}

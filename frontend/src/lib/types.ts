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

export interface Folder {
  id: string
  parent_id: string | null
  name: string
  position: number
}

export interface NoteSummary {
  id: string
  folder_id: string | null
  title: string
  version: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface NoteDetail extends NoteSummary {
  content: string
  frontmatter: Record<string, unknown>
  tags: string[]
  aliases: string[]
}

export interface Tag {
  name: string
  note_count: number
}

export interface SearchResult {
  id: string
  title: string
  folder_id: string | null
  snippet: string
}

export interface Attachment {
  id: string
  filename: string
  mime: string
  size: number
  created_at: string
  used_by: string[]
}

export interface GraphNode {
  id: string
  title: string
  folder_id: string | null
  tags: string[]
  link_count: number
  dangling: boolean
}

export interface GraphEdge {
  source: string
  target: string
  heading: string | null
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

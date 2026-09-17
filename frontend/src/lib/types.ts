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
  linked_tasks: LinkedTask[]
}

export interface LinkedTask {
  id: string
  title: string
  status: TaskStatus
  list_id: string
}

export interface LinkedNote {
  id: string
  title: string
  folder_id: string | null
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

export type TaskListColor =
  'palette-1' | 'palette-2' | 'palette-3' | 'palette-4' | 'palette-5' | 'palette-6'

export type TaskListIcon =
  | 'inbox'
  | 'briefcase'
  | 'home'
  | 'heart'
  | 'star'
  | 'book-open'
  | 'shopping-cart'
  | 'dumbbell'
  | 'plane'
  | 'graduation-cap'
  | 'music'
  | 'code'
  | 'flag'
  | 'target'
  | 'coffee'
  | 'folder'

export interface TaskList {
  id: string
  name: string
  color: TaskListColor
  icon: TaskListIcon
  position: number
  is_inbox: boolean
  archived_at: string | null
}

export type TaskPriority = 'none' | 'low' | 'medium' | 'high'
export type TaskStatus = 'open' | 'done'

export interface Task {
  id: string
  list_id: string
  parent_id: string | null
  title: string
  priority: TaskPriority
  due_date: string | null
  due_time: string | null
  status: TaskStatus
  completed_at: string | null
  reminders_enabled: boolean
  position: number
  subtask_done_count: number
  subtask_total_count: number
  is_recurring: boolean
  rrule: string | null
  recurrence_end: string | null
  created_at: string
  updated_at: string
}

export interface TaskDetail extends Task {
  description: string | null
  subtasks: Task[]
  linked_notes: LinkedNote[]
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type RecurrenceEndType = 'never' | 'on_date' | 'after_count'

export interface RecurrenceInput {
  freq: RecurrenceFreq
  interval?: number
  by_weekday?: number[] | null
  by_month_day?: number | null
  on_last_day?: boolean
  end_type?: RecurrenceEndType
  end_date?: string | null
  end_count?: number | null
}

export type ImportJobStatus = 'pending' | 'processing' | 'done' | 'failed'

export interface ImportReport {
  notes_imported: number
  attachments_imported: number
  conflicts: string[]
  errors: string[]
}

export interface ImportJob {
  id: string
  status: ImportJobStatus
  report: ImportReport | null
  created_at: string
  finished_at: string | null
}

export interface CalendarEntry {
  task_id: string
  list_id: string
  title: string
  priority: TaskPriority
  date: string
  time: string | null
  virtual: boolean
}

import { apiFetch } from '@/lib/api'
import type {
  CalendarEntry,
  RecurrenceInput,
  Task,
  TaskDetail,
  TaskList,
  TaskListColor,
  TaskListIcon,
  TaskPriority,
} from '@/lib/types'

export const listTaskLists = () => apiFetch<TaskList[]>('/task-lists')

export const createTaskList = (input: {
  name: string
  color?: TaskListColor
  icon?: TaskListIcon
}) => apiFetch<TaskList>('/task-lists', { method: 'POST', body: input })

export const updateTaskList = (
  id: string,
  input: {
    name?: string
    color?: TaskListColor
    icon?: TaskListIcon
    position?: number
    archived?: boolean
  },
) => apiFetch<TaskList>(`/task-lists/${id}`, { method: 'PATCH', body: input })

export const deleteTaskList = (id: string, deleteTasks: boolean) =>
  apiFetch<void>(`/task-lists/${id}?delete_tasks=${deleteTasks}`, { method: 'DELETE' })

export interface ListTasksParams {
  listId?: string
  view?: 'today' | 'upcoming'
  status?: 'open' | 'done' | 'all'
  priority?: TaskPriority
}

export const listTasks = (params: ListTasksParams = {}) => {
  const search = new URLSearchParams()
  if (params.listId) search.set('list_id', params.listId)
  if (params.view) search.set('view', params.view)
  if (params.status) search.set('status', params.status)
  if (params.priority) search.set('priority', params.priority)
  const qs = search.toString()
  return apiFetch<Task[]>(`/tasks${qs ? `?${qs}` : ''}`)
}

export const getTask = (id: string) => apiFetch<TaskDetail>(`/tasks/${id}`)

export const createTask = (input: {
  title: string
  description?: string
  list_id?: string | null
  parent_id?: string | null
  priority?: TaskPriority
  due_date?: string | null
  due_time?: string | null
  reminders_enabled?: boolean
  recurrence?: RecurrenceInput | null
}) => apiFetch<Task>('/tasks', { method: 'POST', body: input })

export const updateTask = (
  id: string,
  input: {
    title?: string
    description?: string
    list_id?: string
    priority?: TaskPriority
    due_date?: string
    due_time?: string
    clear_due_date?: boolean
    clear_due_time?: boolean
    reminders_enabled?: boolean
    position?: number
    recurrence?: RecurrenceInput | null
    clear_recurrence?: boolean
  },
) => apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: input })

export const completeTask = (id: string, completeSubtasks = false) =>
  apiFetch<Task>(`/tasks/${id}/complete`, {
    method: 'POST',
    body: { complete_subtasks: completeSubtasks },
  })

export const reopenTask = (id: string) => apiFetch<Task>(`/tasks/${id}/reopen`, { method: 'POST' })

export const skipTask = (id: string) => apiFetch<Task>(`/tasks/${id}/skip`, { method: 'POST' })

export const deleteTask = (id: string) => apiFetch<void>(`/tasks/${id}`, { method: 'DELETE' })

export const getCalendar = (start: string, end: string) =>
  apiFetch<CalendarEntry[]>(`/tasks/calendar?start=${start}&end=${end}`)

export const linkNote = (taskId: string, noteId: string) =>
  apiFetch<void>(`/tasks/${taskId}/notes`, { method: 'POST', body: { note_id: noteId } })

export const unlinkNote = (taskId: string, noteId: string) =>
  apiFetch<void>(`/tasks/${taskId}/notes/${noteId}`, { method: 'DELETE' })

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as tasksApi from '@/features/tasks/api'
import type { ListTasksParams } from '@/features/tasks/api'

export const taskListsKey = ['task-lists'] as const
export const tasksKey = (params: ListTasksParams = {}) => ['tasks', params] as const
export const taskKey = (id: string) => ['tasks', 'detail', id] as const

export function useTaskLists() {
  return useQuery({ queryKey: taskListsKey, queryFn: tasksApi.listTaskLists })
}

function useInvalidateTaskLists() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: taskListsKey })
}

export function useCreateTaskList() {
  const invalidate = useInvalidateTaskLists()
  return useMutation({ mutationFn: tasksApi.createTaskList, onSuccess: invalidate })
}

export function useUpdateTaskList() {
  const invalidate = useInvalidateTaskLists()
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: { id: string } & Parameters<typeof tasksApi.updateTaskList>[1]) =>
      tasksApi.updateTaskList(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteTaskList() {
  const invalidate = useInvalidateTaskLists()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, deleteTasks }: { id: string; deleteTasks: boolean }) =>
      tasksApi.deleteTaskList(id, deleteTasks),
    onSuccess: () => {
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useTasks(params: ListTasksParams = {}) {
  return useQuery({ queryKey: tasksKey(params), queryFn: () => tasksApi.listTasks(params) })
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: taskKey(id ?? ''),
    queryFn: () => tasksApi.getTask(id as string),
    enabled: id !== undefined,
  })
}

function useInvalidateTasks() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['tasks'] })
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: tasksApi.createTask, onSuccess: invalidate })
}

export function useUpdateTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof tasksApi.updateTask>[1]) =>
      tasksApi.updateTask(id, input),
    onSuccess: invalidate,
  })
}

export function useCompleteTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({
    meta: { handledStatuses: [409] },
    mutationFn: ({ id, completeSubtasks }: { id: string; completeSubtasks?: boolean }) =>
      tasksApi.completeTask(id, completeSubtasks),
    onSuccess: invalidate,
  })
}

export function useReopenTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: tasksApi.reopenTask, onSuccess: invalidate })
}

export function useSkipTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: tasksApi.skipTask, onSuccess: invalidate })
}

export function useDeleteTask() {
  const invalidate = useInvalidateTasks()
  return useMutation({ mutationFn: tasksApi.deleteTask, onSuccess: invalidate })
}

export function useCalendar(start: string, end: string) {
  return useQuery({
    queryKey: ['tasks', 'calendar', start, end] as const,
    queryFn: () => tasksApi.getCalendar(start, end),
  })
}

export function useLinkNote(taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => tasksApi.linkNote(taskId, noteId),
    onSuccess: (_data, noteId) => {
      queryClient.invalidateQueries({ queryKey: taskKey(taskId) })
      queryClient.invalidateQueries({ queryKey: ['notes', noteId] })
    },
  })
}

export function useUnlinkNote(taskId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (noteId: string) => tasksApi.unlinkNote(taskId, noteId),
    onSuccess: (_data, noteId) => {
      queryClient.invalidateQueries({ queryKey: taskKey(taskId) })
      queryClient.invalidateQueries({ queryKey: ['notes', noteId] })
    },
  })
}

import { PRIORITY_LABEL, PRIORITY_ORDER } from '@/features/tasks/priority'
import type { Task } from '@/lib/types'

export interface TaskGroup {
  label: string
  tasks: Task[]
}

const NO_PRIORITY_WEIGHT = PRIORITY_ORDER.length

function byPriorityThenDate(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER.indexOf(a.priority)
  const pb = PRIORITY_ORDER.indexOf(b.priority)
  if (pa !== pb)
    return (pa === -1 ? NO_PRIORITY_WEIGHT : pa) - (pb === -1 ? NO_PRIORITY_WEIGHT : pb)
  const da = a.due_date ?? '9999-99-99'
  const db = b.due_date ?? '9999-99-99'
  return da.localeCompare(db)
}

export function groupByPriority(tasks: Task[]): TaskGroup[] {
  const groups = new Map<string, Task[]>()
  for (const priority of PRIORITY_ORDER) groups.set(priority, [])
  for (const task of tasks) groups.get(task.priority)?.push(task)

  return PRIORITY_ORDER.map((priority) => ({
    label: PRIORITY_LABEL[priority],
    tasks: (groups.get(priority) ?? []).sort(byPriorityThenDate),
  })).filter((g) => g.tasks.length > 0)
}

export function groupByDate(tasks: Task[]): TaskGroup[] {
  const dated = tasks.filter((t) => t.due_date).sort(byPriorityThenDate)
  const undated = tasks.filter((t) => !t.due_date).sort(byPriorityThenDate)

  const groups = new Map<string, Task[]>()
  for (const task of dated) {
    const list = groups.get(task.due_date!) ?? []
    list.push(task)
    groups.set(task.due_date!, list)
  }

  const result: TaskGroup[] = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({ label: date, tasks: group }))

  if (undated.length > 0) result.push({ label: 'No date', tasks: undated })
  return result
}

export function noGrouping(tasks: Task[]): TaskGroup[] {
  const sorted = [...tasks].sort(byPriorityThenDate)
  return sorted.length > 0 ? [{ label: '', tasks: sorted }] : []
}

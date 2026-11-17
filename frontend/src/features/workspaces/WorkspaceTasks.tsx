import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { QueryState } from '@/design/components/QueryState'
import { Switch } from '@/design/components/Switch'
import { Plus } from '@/design/icons'
import { useTaskLists, useTasks, useUpdateTaskList } from '@/features/tasks/hooks'
import { TaskCreateDialog } from '@/features/tasks/TaskCreateDialog'
import { TaskDetailDialog } from '@/features/tasks/TaskDetailDialog'
import { TaskGroupedList } from '@/features/tasks/TaskGroupedList'
import { TaskListEditDialog } from '@/features/tasks/TaskListEditDialog'
import type { Folder, Task, TaskList } from '@/lib/types'

export function WorkspaceTasks({
  folder,
  assignments,
  overview = false,
}: {
  folder?: Folder
  assignments: Map<string, Folder>
  overview?: boolean
}) {
  const [completed, setCompleted] = useState(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [createTask, setCreateTask] = useState(false)
  const [createList, setCreateList] = useState(false)
  const [linkList, setLinkList] = useState(false)
  const openTask = useCallback((task: Task) => setOpenTaskId(task.id), [])
  const tasksQuery = useTasks({ status: completed ? 'all' : 'open' })
  const listsQuery = useTaskLists()

  if (!tasksQuery.data) return <QueryState query={tasksQuery} compact={overview} />
  if (!listsQuery.data) return <QueryState query={listsQuery} compact={overview} />

  const lists = listsQuery.data
  const listById = new Map(lists.map((list) => [list.id, list]))
  const listWorkspace = (list?: TaskList) => assignments.get(list?.workspace_id ?? '')
  const projectLists = folder
    ? lists.filter((list) => listWorkspace(list)?.id === folder.id && !list.archived_at)
    : []
  const unassignedLists = folder
    ? lists.filter((list) => !list.is_inbox && !list.archived_at && !listWorkspace(list))
    : []
  const groupMap = new Map<string, { key: string; label: string; tasks: Task[] }>()
  const tasks = tasksQuery.data.filter((task) => {
    const list = listById.get(task.list_id)
    return (!folder || listWorkspace(list)?.id === folder.id) && (!overview || !list?.archived_at)
  })

  for (const task of overview ? tasks.slice(0, 4) : tasks) {
    const list = listById.get(task.list_id)
    const workspace = listWorkspace(list)
    const key = overview
      ? 'summary'
      : folder
        ? task.list_id
        : (workspace?.id ?? (list?.is_inbox ? 'inbox' : 'unassigned'))
    const label = overview
      ? ''
      : folder
        ? (list?.name ?? 'No list')
        : (workspace?.name ?? (list?.is_inbox ? 'Inbox' : 'No workspace'))
    const group = groupMap.get(key) ?? { key, label, tasks: [] }
    group.tasks.push(task)
    groupMap.set(key, group)
  }

  return (
    <div className="grid gap-4">
      {!overview && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(!folder || projectLists.length > 0) && (
              <Button variant="primary" onClick={() => setCreateTask(true)}>
                <Plus size={16} /> Add task
              </Button>
            )}
            {folder && (
              <>
                <Button
                  variant={projectLists.length ? 'secondary' : 'primary'}
                  onClick={() => setCreateList(true)}
                >
                  New list
                </Button>
                {unassignedLists.length > 0 && (
                  <Button variant="ghost" onClick={() => setLinkList(true)}>
                    Link existing list
                  </Button>
                )}
              </>
            )}
            <label className="ml-auto flex items-center gap-2 text-sm text-text-muted">
              <Switch checked={completed} onCheckedChange={setCompleted} label="Show completed" />
              Show completed
            </label>
          </div>
          {projectLists.length > 0 && (
            <nav aria-label="Workspace task lists" className="flex flex-wrap gap-2">
              {projectLists.map((list) => (
                <Link
                  key={list.id}
                  to={'/tasks/list/' + list.id}
                  className="ui-nav-item bg-surface px-3 py-2 text-sm"
                >
                  {list.name}
                </Link>
              ))}
            </nav>
          )}
        </>
      )}
      <TaskGroupedList
        groups={Array.from(groupMap.values())}
        onOpenTask={openTask}
        emptyMessage="No tasks yet"
      />
      <TaskDetailDialog taskId={openTaskId} onOpenChange={(open) => !open && setOpenTaskId(null)} />
      {createTask && (
        <TaskCreateDialog
          open
          onOpenChange={setCreateTask}
          listId={projectLists[0]?.id}
          allowedListIds={folder ? projectLists.map((list) => list.id) : undefined}
        />
      )}
      {createList && (
        <TaskListEditDialog
          list={null}
          open
          onOpenChange={setCreateList}
          workspaceId={folder?.id}
        />
      )}
      {linkList && folder && (
        <LinkListDialog
          workspace={folder}
          lists={unassignedLists}
          close={() => setLinkList(false)}
        />
      )}
    </div>
  )
}

function LinkListDialog({
  workspace,
  lists,
  close,
}: {
  workspace: Folder
  lists: TaskList[]
  close: () => void
}) {
  const update = useUpdateTaskList()
  const [listId, setListId] = useState(lists[0]?.id ?? '')

  return (
    <Dialog open onOpenChange={(open) => !open && close()} title="Link a task list">
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (lists.some((list) => list.id === listId) && !update.isPending) {
            update.mutate({ id: listId, workspace_id: workspace.id }, { onSuccess: close })
          }
        }}
      >
        <label className="grid gap-1.5 text-sm">
          List
          <select
            data-autofocus
            className="ui-field h-10 border border-border bg-surface px-3"
            value={listId}
            onChange={(event) => setListId(event.target.value)}
          >
            {lists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="submit"
          variant="primary"
          className="justify-self-end"
          disabled={!listId || update.isPending}
        >
          Link list
        </Button>
      </form>
    </Dialog>
  )
}

import { type DragEvent, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { clsx } from 'clsx'
import { Calendar, CalendarClock, CalendarRange, MoreHorizontal, Plus } from '@/design/icons'
import { DropdownMenu, type DropdownMenuItem } from '@/design/components/DropdownMenu'
import { IconButton } from '@/design/components/IconButton'
import { useDeleteTaskList, useTaskLists, useUpdateTaskList } from '@/features/tasks/hooks'
import { LIST_ICON_COMPONENT, listColorVar } from '@/features/tasks/listStyle'
import { TaskListEditDialog } from '@/features/tasks/TaskListEditDialog'
import { DeleteTaskListDialog } from '@/features/tasks/DeleteTaskListDialog'
import type { TaskList } from '@/lib/types'
import { QueryState } from '@/design/components/QueryState'

const DRAG_MIME = 'application/x-nook-task-list'

const fixedNavClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'ui-nav-item flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors duration-150',
    isActive
      ? 'bg-surface-raised text-text'
      : 'text-text-muted hover:text-text hover:bg-surface-raised/60',
  )

export function TaskListSidebar() {
  const taskListsQuery = useTaskLists()
  const updateList = useUpdateTaskList()
  const deleteList = useDeleteTaskList()
  const [editingList, setEditingList] = useState<TaskList | null>(null)
  const [creating, setCreating] = useState(false)
  const [deletingList, setDeletingList] = useState<TaskList | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  if (!taskListsQuery.data) return <QueryState query={taskListsQuery} compact />

  const active = taskListsQuery.data
    .filter((l) => !l.archived_at)
    .sort((a, b) => a.position - b.position)
  const archived = taskListsQuery.data.filter((l) => l.archived_at)

  function handleDrop(e: DragEvent, target: TaskList) {
    e.preventDefault()
    setDragOverId(null)
    const draggedId = e.dataTransfer.getData(DRAG_MIME)
    if (!draggedId || draggedId === target.id) return
    const dragged = active.find((l) => l.id === draggedId)
    if (!dragged) return

    const reordered = active.filter((l) => l.id !== draggedId)
    const targetIndex = reordered.findIndex((l) => l.id === target.id)
    reordered.splice(targetIndex, 0, dragged)
    reordered.forEach((l, index) => {
      if (l.position !== index) updateList.mutate({ id: l.id, position: index })
    })
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      <nav className="mb-2 flex flex-col gap-0.5">
        <NavLink to="/tasks/today" className={fixedNavClass}>
          <CalendarClock size={15} strokeWidth={1.5} />
          Today
        </NavLink>
        <NavLink to="/tasks/upcoming" className={fixedNavClass}>
          <CalendarRange size={15} strokeWidth={1.5} />
          Upcoming
        </NavLink>
        <NavLink to="/tasks/calendar" className={fixedNavClass}>
          <Calendar size={15} strokeWidth={1.5} />
          Calendar
        </NavLink>
      </nav>

      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Lists</span>
        <IconButton label="New list" onClick={() => setCreating(true)}>
          <Plus size={14} strokeWidth={1.5} />
        </IconButton>
      </div>

      {active.map((list) => {
        const Icon = LIST_ICON_COMPONENT[list.icon]
        const items: DropdownMenuItem[] = [
          { label: 'Edit', onSelect: () => setEditingList(list) },
          ...(list.is_inbox
            ? []
            : [
                {
                  label: 'Archive',
                  onSelect: () => updateList.mutate({ id: list.id, archived: true }),
                },
                { label: 'Delete', danger: true, onSelect: () => setDeletingList(list) },
              ]),
        ]

        return (
          <div
            key={list.id}
            draggable={!list.is_inbox}
            onDragStart={(e) => e.dataTransfer.setData(DRAG_MIME, list.id)}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverId(list.id)
            }}
            onDragLeave={() => setDragOverId((id) => (id === list.id ? null : id))}
            onDrop={(e) => handleDrop(e, list)}
            className={clsx(
              'ui-nav-item group flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-surface-raised',
              dragOverId === list.id && 'ring-1 ring-accent',
            )}
          >
            <NavLink
              to={`/tasks/list/${list.id}`}
              className={({ isActive }) =>
                clsx(
                  'flex flex-1 items-center gap-2 truncate',
                  isActive ? 'text-text' : 'text-text-muted',
                )
              }
            >
              <Icon size={14} strokeWidth={1.5} style={{ color: listColorVar(list.color) }} />
              <span className="truncate">{list.name}</span>
            </NavLink>
            <span className="reveal-on-hover">
              <DropdownMenu
                items={items}
                trigger={
                  <IconButton label={`Actions for ${list.name}`} className="h-6 w-6">
                    <MoreHorizontal size={13} strokeWidth={1.5} />
                  </IconButton>
                }
              />
            </span>
          </div>
        )
      })}

      {archived.length > 0 && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="px-1 text-xs text-text-muted hover:text-text"
          >
            {showArchived ? 'Hide' : 'Show'} archived ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-1 flex flex-col gap-0.5">
              {archived.map((list) => {
                const Icon = LIST_ICON_COMPONENT[list.icon]
                return (
                  <div
                    key={list.id}
                    className="flex items-center gap-2 rounded-md px-1 py-1 text-sm text-text-muted"
                  >
                    <Icon size={14} strokeWidth={1.5} />
                    <span className="flex-1 truncate">{list.name}</span>
                    <button
                      type="button"
                      onClick={() => updateList.mutate({ id: list.id, archived: false })}
                      className="text-xs hover:text-text"
                    >
                      Unarchive
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <TaskListEditDialog
        list={editingList}
        open={editingList !== null}
        onOpenChange={(open) => !open && setEditingList(null)}
      />
      <TaskListEditDialog list={null} open={creating} onOpenChange={setCreating} />
      <DeleteTaskListDialog
        listName={deletingList?.name ?? null}
        onOpenChange={(open) => !open && setDeletingList(null)}
        onConfirm={(deleteTasks) => {
          if (deletingList) deleteList.mutate({ id: deletingList.id, deleteTasks })
          setDeletingList(null)
        }}
      />
    </div>
  )
}

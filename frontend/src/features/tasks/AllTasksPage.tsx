import { useMemo } from 'react'
import { QueryState } from '@/design/components/QueryState'
import { useFolders } from '@/features/notes/hooks'
import { WorkspaceTasks } from '@/features/workspaces/WorkspaceTasks'
import { workspaceByFolder } from '@/features/workspaces/workspaces'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export default function AllTasksPage() {
  const folders = useFolders()
  const assignments = useMemo(() => workspaceByFolder(folders.data), [folders.data])
  useDocumentTitle('All tasks')

  return (
    <section className="mx-auto max-w-5xl px-4 py-7 sm:px-9 sm:py-10">
      <h1 className="ui-rise mb-6 text-4xl font-extrabold tracking-tight sm:text-5xl">All tasks</h1>
      {folders.data ? <WorkspaceTasks assignments={assignments} /> : <QueryState query={folders} />}
    </section>
  )
}

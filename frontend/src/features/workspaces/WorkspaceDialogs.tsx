import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { useCreateFolder, useCreateNote, useUpdateFolder } from '@/features/notes/hooks'
import { workspacePath } from '@/features/workspaces/workspaces'
import type { Folder } from '@/lib/types'

export function WorkspaceEditDialog({ folder, close }: { folder?: Folder; close: () => void }) {
  const navigate = useNavigate()
  const create = useCreateFolder()
  const update = useUpdateFolder()
  const [name, setName] = useState(folder?.name ?? '')
  const [description, setDescription] = useState(folder?.description ?? '')
  const pending = create.isPending || update.isPending

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || pending) return
    if (folder) {
      update.mutate(
        { id: folder.id, name: name.trim(), description: description.trim() || null },
        { onSuccess: close },
      )
    } else {
      create.mutate(
        { name: name.trim(), description: description.trim() || null },
        {
          onSuccess: (workspace) => {
            close()
            navigate(workspacePath(workspace.id))
          },
        },
      )
    }
  }

  return (
    <Dialog
      title={folder ? 'Edit workspace' : 'New workspace'}
      open
      onOpenChange={(open) => !open && close()}
    >
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-sm">
          Name
          <input
            data-autofocus
            required
            maxLength={255}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="ui-field h-10 border border-border bg-surface px-3 focus-visible:border-accent"
          />
        </label>
        <label className="grid gap-1.5 text-sm">
          Description
          <textarea
            rows={4}
            maxLength={2000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="rounded-md border border-border bg-surface p-3 focus-visible:border-accent"
          />
        </label>
        <Button type="submit" variant="primary" className="justify-self-end" disabled={pending}>
          {folder ? 'Save workspace' : 'Create workspace'}
        </Button>
      </form>
    </Dialog>
  )
}

export function WorkspaceNoteDialog({ folder, close }: { folder?: Folder; close: () => void }) {
  const navigate = useNavigate()
  const create = useCreateNote()
  const [title, setTitle] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || create.isPending) return
    create.mutate(
      { title: title.trim(), folder_id: folder?.id ?? null },
      {
        onSuccess: (note) => {
          close()
          navigate('/notes/' + note.id)
        },
      },
    )
  }

  return (
    <Dialog
      title={'New note · ' + (folder?.name ?? 'Inbox')}
      open
      onOpenChange={(open) => !open && close()}
    >
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-sm">
          Title
          <input
            data-autofocus
            required
            maxLength={255}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="ui-field h-10 border border-border bg-surface px-3 focus-visible:border-accent"
          />
        </label>
        <Button
          type="submit"
          variant="primary"
          className="justify-self-end"
          disabled={create.isPending}
        >
          Create note
        </Button>
      </form>
    </Dialog>
  )
}

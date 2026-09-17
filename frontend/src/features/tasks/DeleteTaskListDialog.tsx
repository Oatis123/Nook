import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'

export function DeleteTaskListDialog({
  listName,
  onOpenChange,
  onConfirm,
}: {
  listName: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (deleteTasks: boolean) => void
}) {
  return (
    <Dialog
      open={listName !== null}
      onOpenChange={onOpenChange}
      title={`Delete "${listName}"?`}
      description="What should happen to the tasks in this list?"
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="secondary" onClick={() => onConfirm(false)}>
          Move tasks to Inbox
        </Button>
        <Button variant="danger" onClick={() => onConfirm(true)}>
          Delete tasks too
        </Button>
      </div>
    </Dialog>
  )
}

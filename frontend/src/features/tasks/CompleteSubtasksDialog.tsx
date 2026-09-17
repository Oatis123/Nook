import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'

export function CompleteSubtasksDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Complete all subtasks?"
      description="This task still has open subtasks. Completing it will mark them all done too."
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={() => {
            onConfirm()
            onOpenChange(false)
          }}
        >
          Complete all
        </Button>
      </div>
    </Dialog>
  )
}

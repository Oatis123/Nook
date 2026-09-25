import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'
import { useConfirmStore } from '@/lib/confirm'

/** Renders the dialog for confirmAction() — mounted once at the app root. */
export function ConfirmHost() {
  const request = useConfirmStore((s) => s.request)
  const settle = useConfirmStore((s) => s.settle)

  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) settle(false)
      }}
      title={request?.title ?? ''}
      description={request?.description}
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => settle(false)}>
          Cancel
        </Button>
        <Button
          variant={request?.danger ? 'danger' : 'primary'}
          autoFocus
          onClick={() => settle(true)}
        >
          {request?.confirmLabel ?? 'Confirm'}
        </Button>
      </div>
    </Dialog>
  )
}

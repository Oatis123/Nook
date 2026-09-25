import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'

export function RenameLinksDialog({
  open,
  affectedNotes,
  onUpdateLinks,
  onSkip,
}: {
  open: boolean
  affectedNotes: number
  onUpdateLinks: () => void
  onSkip: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onSkip()
      }}
      title="Update links to this note?"
      description={`${affectedNotes} ${affectedNotes === 1 ? 'note links' : 'notes link'} to this note by its old title.`}
    >
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onSkip}>
          Leave as-is
        </Button>
        <Button variant="primary" onClick={onUpdateLinks}>
          Update {affectedNotes === 1 ? 'it' : 'them'}
        </Button>
      </div>
    </Dialog>
  )
}

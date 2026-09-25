import { useState } from 'react'
import { Button } from '@/design/components/Button'
import { Dialog } from '@/design/components/Dialog'

export function ConflictDialog({
  open,
  myContent,
  serverContent,
  onKeepMine,
  onLoadServer,
}: {
  open: boolean
  myContent: string
  serverContent: string
  onKeepMine: () => void
  onLoadServer: () => void
}) {
  const [showDiff, setShowDiff] = useState(false)

  return (
    <Dialog
      open={open}
      dismissible={false}
      title="This note changed elsewhere"
      description="It was edited in another session since you started. Choose which version to keep."
    >
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowDiff((v) => !v)}
          className="self-start text-sm text-accent hover:underline"
        >
          {showDiff ? 'Hide comparison' : 'Show comparison'}
        </button>

        {showDiff && (
          <div className="grid max-h-64 grid-cols-2 gap-3 overflow-y-auto text-xs">
            <div>
              <p className="mb-1 font-medium text-text-muted">Yours</p>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface p-2 font-mono">
                {myContent}
              </pre>
            </div>
            <div>
              <p className="mb-1 font-medium text-text-muted">Server</p>
              <pre className="whitespace-pre-wrap rounded-md border border-border bg-surface p-2 font-mono">
                {serverContent}
              </pre>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onLoadServer}>
            Load server version
          </Button>
          <Button variant="primary" onClick={onKeepMine}>
            Keep my version
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

import { useEffect } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import { Search } from 'lucide-react'
import { useUIStore } from '@/lib/ui-store'

/** Minimal shell for Cmd/Ctrl+K. Real fuzzy search lands with the Search feature (spec §6.7). */
export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen)
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(!useUIStore.getState().commandPaletteOpen)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/30 animate-fade-in" />
        <RadixDialog.Content
          className={[
            'fixed left-1/2 top-[20vh] z-50 w-[90vw] max-w-lg -translate-x-1/2',
            'rounded-lg border border-border bg-surface-raised shadow-(--shadow-popover)',
            'animate-fade-in',
          ].join(' ')}
        >
          <RadixDialog.Title className="sr-only">Command palette</RadixDialog.Title>
          <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
            <Search size={16} strokeWidth={1.5} className="text-text-muted" />
            <input
              autoFocus
              placeholder="Search notes, tasks, commands…"
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
            />
          </div>
          <p className="px-4 py-6 text-center text-sm text-text-muted">Search is coming soon.</p>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

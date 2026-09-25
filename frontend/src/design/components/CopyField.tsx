import { useRef, useState } from 'react'
import { Check, Copy } from '@/design/icons'
import { toast } from '@/lib/toast'

/** Copies via the async clipboard API, falling back to a selection + execCommand — the
 * API only exists in secure contexts, so it's missing on a self-hosted instance served
 * over plain http. */
async function copyText(text: string, input: HTMLInputElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  if (!input) return false
  input.focus()
  input.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

/** A read-only, fully visible value (token, link) with a copy button and feedback. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (await copyText(value, inputRef.current)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } else {
      inputRef.current?.select()
      toast.info('Press Ctrl+C (⌘C) to copy the selected text.')
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2">
      <input
        ref={inputRef}
        readOnly
        value={value}
        aria-label={label}
        onFocus={(e) => e.currentTarget.select()}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs text-text outline-none"
      />
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        className="flex shrink-0 items-center gap-1 text-xs text-text-muted hover:text-text"
      >
        {copied ? (
          <>
            <Check size={15} strokeWidth={1.5} /> Copied
          </>
        ) : (
          <Copy size={15} strokeWidth={1.5} />
        )}
      </button>
    </div>
  )
}

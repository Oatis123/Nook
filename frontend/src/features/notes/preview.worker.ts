/// <reference lib="webworker" />
import {
  createPreviewRenderer,
  HighlighterUnavailableError,
  type PreviewBlocks,
  type PreviewContext,
} from '@/features/notes/previewPipeline'

export type PreviewWorkerRequest =
  | { type: 'context'; context: PreviewContext }
  | { type: 'render'; id: number; session: number; content: string; have: string[] }

export type PreviewResult =
  | ({ status: 'done' } & PreviewBlocks)
  | { status: 'skipped' }
  | { status: 'error'; error: 'highlighter' | 'render'; detail?: string }

export type PreviewWorkerResponse = { id: number } & PreviewResult

declare const self: DedicatedWorkerGlobalScope

const renderer = createPreviewRenderer()
// One render at a time, in order. A request superseded by a newer one from the same
// preview while it waited is answered as skipped: that preview has moved on to newer text.
let queue: Promise<void> = Promise.resolve()
const latestBySession = new Map<number, number>()

self.onmessage = (event: MessageEvent<PreviewWorkerRequest>) => {
  const message = event.data
  if (message.type === 'context') {
    queue = queue
      .then(() => renderer.setContext(message.context))
      .catch((error) => {
        console.error('[preview.worker] Failed to set context:', error)
      })
    return
  }
  latestBySession.set(message.session, message.id)
  queue = queue
    .then(async () => {
      let result: PreviewResult
      if (latestBySession.get(message.session) !== message.id) {
        result = { status: 'skipped' }
      } else {
        try {
          const blocks = await renderer.render(message.content, new Set(message.have))
          result = { status: 'done', ...blocks }
        } catch (error) {
          const isHighlighter = error instanceof HighlighterUnavailableError
          if (!isHighlighter) {
            console.error('[preview.worker] Preview render failed:', error)
          }
          result = {
            status: 'error',
            error: isHighlighter ? 'highlighter' : 'render',
            detail: error instanceof Error ? error.message : String(error),
          }
        }
      }
      self.postMessage({ id: message.id, ...result } satisfies PreviewWorkerResponse)
    })
    .catch((error) => {
      console.error('[preview.worker] Unhandled queue error:', error)
    })
}

import type {
  PreviewResult,
  PreviewWorkerRequest,
  PreviewWorkerResponse,
} from '@/features/notes/preview.worker'
import type { PreviewContext } from '@/features/notes/previewPipeline'

/** Renders note previews in a Web Worker, so a long note's parse and highlight run beside
 * the editor instead of freezing it. Where a worker can't run (an old browser without
 * module workers, a blocked script), the same pipeline runs on the main thread. */

interface Pending {
  resolve: (result: PreviewResult) => void
  context: PreviewContext
  content: string
  have: ReadonlySet<string>
}

let worker: Worker | null | undefined // undefined: not started yet; null: unavailable
let postedContext: PreviewContext | null = null
type Pipeline = typeof import('@/features/notes/previewPipeline')
// Loaded only when there's no worker: otherwise the whole pipeline (unified, Shiki…) would
// be in the editor's own bundle as well as the worker's.
let pipeline: Promise<Pipeline> | null = null
let mainThreadRenderer: ReturnType<Pipeline['createPreviewRenderer']> | null = null
let mainThreadContext: PreviewContext | null = null
let nextId = 1
let nextSession = 1
const pending = new Map<number, Pending>()

async function renderOnMainThread(
  context: PreviewContext,
  content: string,
  have: ReadonlySet<string>,
): Promise<PreviewResult> {
  pipeline ??= import('@/features/notes/previewPipeline')
  let loaded: Pipeline
  try {
    loaded = await pipeline
  } catch (error) {
    console.error('[previewClient] Failed to load previewPipeline on main thread:', error)
    pipeline = null // a network blip: the next render tries again
    return {
      status: 'error',
      error: 'render',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
  mainThreadRenderer ??= loaded.createPreviewRenderer()
  if (mainThreadContext !== context) {
    mainThreadRenderer.setContext(context)
    mainThreadContext = context
  }
  try {
    return { status: 'done', ...(await mainThreadRenderer.render(content, have)) }
  } catch (error) {
    const isHighlighter = error instanceof loaded.HighlighterUnavailableError
    if (!isHighlighter) {
      console.error('[previewClient] Main-thread preview render failed:', error)
    }
    return {
      status: 'error',
      error: isHighlighter ? 'highlighter' : 'render',
      detail: error instanceof Error ? error.message : String(error),
    }
  }
}

function failOver(event?: Event) {
  console.warn('[previewClient] Preview worker failed; falling back to main thread:', event)
  worker?.terminate()
  worker = null
  const stranded = [...pending.values()]
  pending.clear()
  for (const request of stranded) {
    void renderOnMainThread(request.context, request.content, request.have).then(request.resolve)
  }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./preview.worker.ts', import.meta.url), { type: 'module' })
  } catch (error) {
    if (typeof Worker !== 'undefined') {
      console.warn('[previewClient] Could not start preview worker; using main thread:', error)
    }
    worker = null
    return null
  }
  worker.onmessage = (event: MessageEvent<PreviewWorkerResponse>) => {
    const { id, ...result } = event.data
    const request = pending.get(id)
    pending.delete(id)
    request?.resolve(result)
  }
  worker.onerror = (event) => failOver(event)
  worker.onmessageerror = (event) => failOver(event)
  return worker
}

/** One per mounted preview: a newer render from the same preview supersedes an older one
 * still waiting in the worker. */
export function createPreviewSession() {
  const session = nextSession++
  return {
    render(context: PreviewContext, content: string, have: ReadonlySet<string>) {
      const w = getWorker()
      if (!w) return renderOnMainThread(context, content, have)
      if (postedContext !== context) {
        w.postMessage({ type: 'context', context } satisfies PreviewWorkerRequest)
        postedContext = context
      }
      const id = nextId++
      return new Promise<PreviewResult>((resolve) => {
        pending.set(id, { resolve, context, content, have })
        w.postMessage({
          type: 'render',
          id,
          session,
          content,
          have: [...have],
        } satisfies PreviewWorkerRequest)
      })
    },
  }
}

/** The pages people open most. They're split out of the first load (see router.tsx), so
 * once the app is up and idle their code is fetched in the background — the first visit
 * to each then doesn't wait on the network. */
const commonPages = [
  () => import('@/features/notes/NoteEditorRoute'),
  () => import('@/features/tasks/TodayView'),
  () => import('@/features/tasks/ListView'),
  () => import('@/features/tasks/UpcomingView'),
]

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
  cancelIdleCallback?: (handle: number) => void
}

/** Fetches one page per idle period. Returns a function that stops it. */
export function prefetchCommonPages(): () => void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return () => {}

  const w = window as IdleWindow
  const queue = [...commonPages]
  let handle: number | null = null
  let stopped = false

  function schedule() {
    if (stopped || queue.length === 0) return
    handle = w.requestIdleCallback
      ? w.requestIdleCallback(next, { timeout: 5000 })
      : window.setTimeout(next, 1500)
  }
  function next() {
    const load = queue.shift()
    // A failed prefetch is harmless: the route fetches its code again when visited.
    load?.().catch(() => {})
    schedule()
  }

  schedule()
  return () => {
    stopped = true
    if (handle === null) return
    if (w.cancelIdleCallback) w.cancelIdleCallback(handle)
    else window.clearTimeout(handle)
  }
}

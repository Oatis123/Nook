/**
 * Clicks that turn into drags.
 *
 * The notes tree rows, task lists in the sidebar and calendar entries are draggable, and a
 * browser starts a native drag — instead of a click — once the pointer moves a few pixels
 * with the button down. A click made "on the move", the cursor still travelling as it
 * lands, therefore opened nothing and had to be repeated more carefully.
 *
 * A drag released on the element it started from, or within CLICK_SLOP_PX of where it
 * started, is treated as the click it was meant to be: on dragend the element that was
 * pressed gets a click(), and drop handlers check `isClickDrag()` to leave things where
 * they are. Tracking happens in document-level capture listeners, which run before React's
 * own (attached at the root), so drop handlers always see the drag's final position.
 * Only one drag can be in progress, so module-level state is enough.
 */

export const CLICK_SLOP_PX = 12

type Drag = {
  source: Node
  startX: number
  startY: number
  x: number
  y: number
  over: EventTarget | null
}

let pressed: EventTarget | null = null
let drag: Drag | null = null

/** True during a drag (and its drop) that is really a click. */
export function isClickDrag(): boolean {
  if (drag === null) return false
  if (drag.over instanceof Node && drag.source.contains(drag.over)) return true
  return Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < CLICK_SLOP_PX
}

function track(e: DragEvent) {
  if (drag === null) return
  drag.over = e.target
  // Some browsers report 0,0 for the final events of a drag; keep the last real position.
  if (e.clientX !== 0 || e.clientY !== 0) {
    drag.x = e.clientX
    drag.y = e.clientY
  }
}

function clickTarget(): HTMLElement | null {
  const node = pressed instanceof Node ? pressed : (drag?.source ?? null)
  const element = node instanceof Element ? node : (node?.parentElement ?? null)
  return element?.closest<HTMLElement>('a, button, [role="button"]') ?? null
}

if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (e) => (pressed = e.target), true)
  document.addEventListener(
    'dragstart',
    (e) => {
      drag = {
        source: e.target as Node,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        over: e.target,
      }
    },
    true,
  )
  document.addEventListener('dragover', track, true)
  document.addEventListener('drop', track, true)
  document.addEventListener(
    'dragend',
    () => {
      if (isClickDrag()) clickTarget()?.click()
      drag = null
    },
    true,
  )
}

/** Where focus should go back to when a dialog closes, if the element that had focus
 * when it opened is gone — typically a dropdown menu item ("Delete", "Move to…") whose
 * menu closed as the dialog opened. The menu's trigger button is the natural target. */
let lastMenuTrigger: HTMLElement | null = null

export function rememberMenuTrigger(element: HTMLElement | null): void {
  lastMenuTrigger = element
}

export function focusReturnFallback(): HTMLElement | null {
  return lastMenuTrigger?.isConnected ? lastMenuTrigger : null
}

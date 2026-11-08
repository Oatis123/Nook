import { type MouseEvent, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'cyber' | 'system'
/** The theme actually in effect; `system` resolves to the OS's light or dark. */
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

const MODE_STORAGE_KEY = 'nook-theme'

/** Nook has one visual theme, the Oatis skin (design/skins/oatis.css), in light, dark and
 * cyber. Its styles hang off `data-theme-skin="oatis"` on <html>, set here and, before
 * first paint, by public/theme-init.js. Cyber is dark-only. */
const SKIN = 'oatis'

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'cyber' || stored === 'system') {
      return stored
    }
  } catch {
    /* localStorage unavailable — fall back to system */
  }
  return 'system'
}

function applyPreferenceToDocument(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', pref)
  }
}

/** Viewport point the theme-change reveal grows from (usually the clicked control). */
export interface ThemeTransitionOrigin {
  x: number
  y: number
}

/** Click position for pointer clicks; the control's center for keyboard activation
 * (which reports detail 0 and a 0,0 pointer position). */
export function transitionOriginFromEvent(e: MouseEvent<HTMLElement>): ThemeTransitionOrigin {
  if (e.detail > 0) return { x: e.clientX, y: e.clientY }
  const rect = e.currentTarget.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** Applies a theme change behind a circular reveal that grows from `origin`, using the
 * View Transitions API. Falls back to an instant switch where unsupported (and under
 * prefers-reduced-motion), which also keeps the store synchronous in tests. */
function runThemeTransition(update: () => void, origin: ThemeTransitionOrigin | undefined) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof document.startViewTransition !== 'function' || reducedMotion) {
    update()
    return
  }

  const root = document.documentElement
  const { x, y } = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
  const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y))

  root.style.setProperty('--theme-transition-x', `${x}px`)
  root.style.setProperty('--theme-transition-y', `${y}px`)
  root.classList.add('theme-transition')
  // flushSync so React commits (icons, active states) before the new snapshot is taken.
  const transition = document.startViewTransition(() => flushSync(update))
  transition.ready
    .then(() => {
      // --theme-reveal is the radius of the clip circle (index.css).
      root.animate(
        { '--theme-reveal': ['0px', `${radius}px`] },
        {
          duration: 220,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
          // Hold the end state — snapping back to 0px would flash the old theme for a
          // frame before the transition tears down.
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        },
      )
    })
    .catch(() => {
      /* transition skipped (e.g. superseded by a newer switch) — the update still applied */
    })
  void transition.finished.finally(() => root.classList.remove('theme-transition'))
}

interface ThemeState {
  preference: ThemePreference
  setPreference: (pref: ThemePreference, origin?: ThemeTransitionOrigin) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readStoredPreference(),
  setPreference: (pref, origin) => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, pref)
    } catch {
      /* localStorage unavailable — preference still applies for this session */
    }
    if (pref === get().preference) return
    runThemeTransition(() => {
      applyPreferenceToDocument(pref)
      set({ preference: pref })
    }, origin)
  },
}))

// Ensure DOM matches store state on module init (covers the case where the inline
// bootstrap script in index.html and this store could otherwise disagree).
applyPreferenceToDocument(useThemeStore.getState().preference)
document.documentElement.setAttribute('data-theme-skin', SKIN)

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The theme actually in effect right now ('system' resolved via the OS setting) —
 * for code that needs a concrete light/dark/cyber choice, like picking a syntax
 * highlighting theme, rather than the CSS-variable cascade the rest of the UI relies on. */
export function useResolvedTheme(): ResolvedTheme {
  const preference = useThemeStore((s) => s.preference)
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  return useSyncExternalStore(
    (onChange) => {
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    () => resolveTheme(preference),
  )
}

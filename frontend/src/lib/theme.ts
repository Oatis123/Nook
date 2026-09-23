import { type MouseEvent, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'
/** The overall visual theme — independent of light/dark mode. Each skin brings its own
 * light + dark palette, fonts, shapes and widget styles (design/skins/*.css) and its
 * own icon set (design/icons.tsx). */
export type ThemeSkin = 'anthropic' | 'telegram' | 'github' | 'material'

export const THEME_SKINS: readonly ThemeSkin[] = ['anthropic', 'telegram', 'github', 'material']

const MODE_STORAGE_KEY = 'nook-theme'
const SKIN_STORAGE_KEY = 'nook-theme-skin'

/** Faces each skin renders its first frame with — loaded before the switch animation
 * starts so the new snapshot doesn't capture fallback fonts mid-swap. */
const SKIN_FONTS: Record<ThemeSkin, string[]> = {
  anthropic: ['400 1em "IBM Plex Sans"', '400 1em Literata'],
  telegram: ['400 1em Roboto', '500 1em Roboto'],
  github: ['600 1em "Mona Sans Variable"'],
  material: ['400 1em "Google Sans Flex Variable"', '1em Roboto'],
}

function isThemeSkin(value: unknown): value is ThemeSkin {
  return THEME_SKINS.includes(value as ThemeSkin)
}

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch {
    /* localStorage unavailable — fall back to system */
  }
  return 'system'
}

function readStoredSkin(): ThemeSkin {
  try {
    const stored = localStorage.getItem(SKIN_STORAGE_KEY)
    if (isThemeSkin(stored)) return stored
  } catch {
    /* localStorage unavailable — fall back to the default skin */
  }
  return 'anthropic'
}

function applyPreferenceToDocument(pref: ThemePreference) {
  const root = document.documentElement
  if (pref === 'system') {
    root.removeAttribute('data-theme')
  } else {
    root.setAttribute('data-theme', pref)
  }
}

function applySkinToDocument(skin: ThemeSkin) {
  const root = document.documentElement
  if (skin === 'anthropic') {
    root.removeAttribute('data-theme-skin')
  } else {
    root.setAttribute('data-theme-skin', skin)
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

function preloadFonts(fonts: string[]): Promise<unknown> {
  if (!document.fonts || fonts.length === 0) return Promise.resolve()
  const loads = Promise.all(fonts.map((font) => document.fonts.load(font))).catch(() => {})
  // Never hold the switch hostage to a slow network — worst case the new theme briefly
  // renders with fallback fonts, same as without preloading.
  return Promise.race([loads, new Promise((resolve) => setTimeout(resolve, 400))])
}

/** Width of the reveal circle's soft edge, px — keep in sync with index.css. */
const REVEAL_FEATHER = 64

/** Applies a theme change behind a circular reveal that grows from `origin`, using the
 * View Transitions API. Falls back to an instant switch where unsupported (and under
 * prefers-reduced-motion), which also keeps the store synchronous in tests. */
function runThemeTransition(
  update: () => void,
  origin: ThemeTransitionOrigin | undefined,
  fonts: string[] = [],
) {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  if (typeof document.startViewTransition !== 'function' || reducedMotion) {
    update()
    return
  }

  void preloadFonts(fonts).then(() => {
    const root = document.documentElement
    const { x, y } = origin ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const radius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    )

    root.style.setProperty('--theme-transition-x', `${x}px`)
    root.style.setProperty('--theme-transition-y', `${y}px`)
    root.classList.add('theme-transition')
    // flushSync so React commits (icons, active states) before the new snapshot is taken.
    const transition = document.startViewTransition(() => flushSync(update))
    transition.ready
      .then(() => {
        // --theme-reveal is the radius of a soft-edged radial mask (index.css); the
        // extra REVEAL_FEATHER makes sure the feathered edge fully clears the corners.
        root.animate(
          { '--theme-reveal': ['0px', `${radius + REVEAL_FEATHER}px`] },
          {
            duration: 700,
            easing: 'cubic-bezier(0.65, 0, 0.35, 1)',
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
  })
}

interface ThemeState {
  preference: ThemePreference
  skin: ThemeSkin
  setPreference: (pref: ThemePreference, origin?: ThemeTransitionOrigin) => void
  setSkin: (skin: ThemeSkin, origin?: ThemeTransitionOrigin) => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  preference: readStoredPreference(),
  skin: readStoredSkin(),
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
  setSkin: (skin, origin) => {
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, skin)
    } catch {
      /* localStorage unavailable — preference still applies for this session */
    }
    if (skin === get().skin) return
    runThemeTransition(
      () => {
        applySkinToDocument(skin)
        set({ skin })
      },
      origin,
      SKIN_FONTS[skin],
    )
  },
}))

// Ensure DOM matches store state on module init (covers the case where the inline
// bootstrap script in index.html and this store could otherwise disagree).
applyPreferenceToDocument(useThemeStore.getState().preference)
applySkinToDocument(useThemeStore.getState().skin)

function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** The theme actually in effect right now ('system' resolved via the OS setting) —
 * for code that needs a concrete light/dark choice, like picking a syntax highlighting
 * theme, rather than the CSS-variable cascade the rest of the UI relies on. */
export function useResolvedTheme(): 'light' | 'dark' {
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

import { create } from 'zustand'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'nook-theme'

function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
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

interface ThemeState {
  preference: ThemePreference
  setPreference: (pref: ThemePreference) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  setPreference: (pref) => {
    try {
      localStorage.setItem(STORAGE_KEY, pref)
    } catch {
      /* localStorage unavailable — preference still applies for this session */
    }
    applyPreferenceToDocument(pref)
    set({ preference: pref })
  },
}))

// Ensure DOM matches store state on module init (covers the case where the inline
// bootstrap script in index.html and this store could otherwise disagree).
applyPreferenceToDocument(useThemeStore.getState().preference)

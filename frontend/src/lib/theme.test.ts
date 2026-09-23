import { beforeEach, describe, expect, it } from 'vitest'
import { THEME_SKINS, useThemeStore } from '@/lib/theme'

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.removeAttribute('data-theme-skin')
    useThemeStore.setState({ preference: 'system', skin: 'anthropic' })
  })

  it('defaults to system', () => {
    expect(useThemeStore.getState().preference).toBe('system')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('sets data-theme and persists the preference on explicit choice', () => {
    useThemeStore.getState().setPreference('dark')

    expect(useThemeStore.getState().preference).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(localStorage.getItem('nook-theme')).toBe('dark')
  })

  it('removes data-theme when switching back to system', () => {
    useThemeStore.getState().setPreference('light')
    useThemeStore.getState().setPreference('system')

    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
    expect(localStorage.getItem('nook-theme')).toBe('system')
  })

  it('defaults to the Anthropic skin', () => {
    expect(useThemeStore.getState().skin).toBe('anthropic')
    expect(document.documentElement.hasAttribute('data-theme-skin')).toBe(false)
  })

  it('sets data-theme-skin and persists the skin on explicit choice', () => {
    useThemeStore.getState().setSkin('telegram')

    expect(useThemeStore.getState().skin).toBe('telegram')
    expect(document.documentElement.getAttribute('data-theme-skin')).toBe('telegram')
    expect(localStorage.getItem('nook-theme-skin')).toBe('telegram')
  })

  it('removes data-theme-skin when switching back to anthropic', () => {
    useThemeStore.getState().setSkin('telegram')
    useThemeStore.getState().setSkin('anthropic')

    expect(document.documentElement.hasAttribute('data-theme-skin')).toBe(false)
    expect(localStorage.getItem('nook-theme-skin')).toBe('anthropic')
  })

  it('keeps skin and mode independent of each other', () => {
    useThemeStore.getState().setSkin('telegram')
    useThemeStore.getState().setPreference('dark')

    expect(document.documentElement.getAttribute('data-theme-skin')).toBe('telegram')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
})

describe('theme skins', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme-skin')
    useThemeStore.setState({ preference: 'system', skin: 'anthropic' })
  })

  it.each(THEME_SKINS.filter((s) => s !== 'anthropic'))(
    'applies and persists the %s skin',
    (skin) => {
      useThemeStore.getState().setSkin(skin)

      expect(useThemeStore.getState().skin).toBe(skin)
      expect(document.documentElement.getAttribute('data-theme-skin')).toBe(skin)
      expect(localStorage.getItem('nook-theme-skin')).toBe(skin)
    },
  )

  it('ignores a transition origin when view transitions are unavailable', () => {
    useThemeStore.getState().setSkin('material', { x: 10, y: 20 })

    expect(document.documentElement.getAttribute('data-theme-skin')).toBe('material')
    expect(document.documentElement.classList.contains('theme-transition')).toBe(false)
  })
})

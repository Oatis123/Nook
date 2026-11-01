import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useThemeStore } from '@/lib/theme'

describe('theme store', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
    useThemeStore.setState({ preference: 'system' })
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

  it('always applies the Oatis skin, whatever an old version stored', async () => {
    document.documentElement.removeAttribute('data-theme-skin')
    localStorage.setItem('nook-theme-skin', 'telegram')
    vi.resetModules()
    await import('@/lib/theme')

    expect(document.documentElement.getAttribute('data-theme-skin')).toBe('oatis')
  })

  it('ignores a transition origin when view transitions are unavailable', () => {
    useThemeStore.getState().setPreference('dark', { x: 10, y: 20 })

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('theme-transition')).toBe(false)
  })
})

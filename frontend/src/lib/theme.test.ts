import { beforeEach, describe, expect, it } from 'vitest'
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
})

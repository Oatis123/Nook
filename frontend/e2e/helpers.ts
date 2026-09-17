import type { Page } from '@playwright/test'

export async function login(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByLabel('Password').fill(password)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login')),
    page.getByRole('button', { name: 'Sign in' }).click(),
  ])
}

/** Resolves once a PATCH for the note currently open (by URL) round-trips, so tests don't
 * have to guess at the 800ms debounce in NoteEditor.tsx or race the "Saved" label. Scoped
 * to the current note's id specifically — an unscoped match can be satisfied by a save
 * left over from a note edited earlier in the same test, letting the test move on before
 * the note it's actually waiting on has saved (and, since that later note's own save still
 * carries the pre-save version, races it into a real 409 version conflict). */
export function waitForNoteSave(page: Page) {
  const noteId = page.url().match(/\/notes\/([^/?#]+)/)?.[1]
  if (!noteId) throw new Error(`waitForNoteSave: not on a note page (${page.url()})`)
  return page.waitForResponse(
    (res) =>
      res.request().method() === 'PATCH' &&
      res.url().includes(`/api/v1/notes/${noteId}`) &&
      res.ok(),
  )
}

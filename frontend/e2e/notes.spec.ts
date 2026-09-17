import { expect, test } from '@playwright/test'
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './config'
import { linkTelegramForUser } from './db'
import { login, waitForNoteSave } from './helpers'

test.beforeAll(() => {
  linkTelegramForUser(ADMIN_USERNAME)
})

test.beforeEach(async ({ page }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD)
  await expect(page.getByLabel('New note')).toBeVisible()
})

test('a wikilink from one note to another shows up as a backlink', async ({ page }) => {
  const stamp = Date.now()
  const titleA = `E2E Note A ${stamp}`
  const titleB = `E2E Note B ${stamp}`

  // "New note" navigates asynchronously (create request -> onSuccess -> router push), so
  // `toHaveURL(/\/notes\//)` alone can pass while still on the *previous* note (that regex
  // matches both). Wait for the URL to actually change, then for the title input to show
  // the fresh note's default before touching it — otherwise a fill can land on the note
  // that's on its way out rather than the one that just replaced it.
  await page.getByLabel('New note').click()
  await page.waitForURL(/\/notes\/[^/]+$/)
  const urlA = page.url()
  const titleInputA = page.getByLabel('Note title')
  await expect(titleInputA).toHaveValue(/^Untitled/)
  await titleInputA.fill(titleA)
  await Promise.all([waitForNoteSave(page), titleInputA.blur()])
  await expect(titleInputA).toHaveValue(titleA)

  await page.getByLabel('New note').click()
  await page.waitForURL((url) => url.toString() !== urlA && /\/notes\/[^/]+$/.test(url.pathname))
  const titleInputB = page.getByLabel('Note title')
  await expect(titleInputB).toHaveValue(/^Untitled/)
  await titleInputB.fill(titleB)
  await Promise.all([waitForNoteSave(page), titleInputB.blur()])
  await expect(titleInputB).toHaveValue(titleB)

  await page.locator('.cm-content').click()
  const saved = waitForNoteSave(page)
  await page.keyboard.type(`Links to [[${titleA}]].`)
  await saved

  await page.getByRole('button', { name: titleA, exact: true }).click()
  await page.waitForURL(urlA)
  await page.getByLabel('Toggle context panel').click()
  // Scoped to the (desktop-only <aside>) context panel: titleB is also the sidebar's note
  // list, an unscoped getByText would match both and violate strict mode.
  const contextPanel = page.locator('aside').filter({ hasText: 'Context' })
  await expect(contextPanel.getByRole('heading', { name: 'Backlinks' })).toBeVisible()
  await expect(contextPanel.getByText(titleB)).toBeVisible()
})

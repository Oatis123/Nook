import { expect, test } from '@playwright/test'
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './config'
import { linkTelegramForUser } from './db'
import { login } from './helpers'

test.beforeAll(() => {
  linkTelegramForUser(ADMIN_USERNAME)
})

test.beforeEach(async ({ page }) => {
  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD)
  await expect(page.getByLabel('New note')).toBeVisible()
})

test('quick add parses a due date and the task lands on Today', async ({ page }) => {
  const title = `E2E Task ${Date.now()}`

  await page.goto('/tasks/today')
  const input = page.getByPlaceholder(/Add a task/)
  await input.fill(`${title} today !high`)

  const created = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === '/api/v1/tasks' &&
      res.ok(),
  )
  await input.press('Enter')
  await created

  await expect(page.getByText(title)).toBeVisible()
})

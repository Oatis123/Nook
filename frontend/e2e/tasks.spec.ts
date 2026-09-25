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

test('a task created for today lands on Today', async ({ page }) => {
  const title = `E2E Task ${Date.now()}`
  // The seeded admin's profile timezone is UTC, so "today" for it is the UTC date.
  const today = new Date().toISOString().slice(0, 10)

  await page.goto('/tasks/today')
  await page.getByRole('button', { name: /Add a task/ }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Task title').fill(title)
  await dialog.getByLabel('Due date').fill(today)
  await dialog.getByLabel('Priority').selectOption('high')

  const created = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      new URL(res.url()).pathname === '/api/v1/tasks' &&
      res.ok(),
  )
  await dialog.getByRole('button', { name: 'Create task' }).click()
  await created

  await expect(dialog).toBeHidden()
  await expect(page.getByText(title)).toBeVisible()
})

import { expect, test } from '@playwright/test'
import { ADMIN_PASSWORD, ADMIN_USERNAME } from './config'
import { linkTelegramForUser } from './db'
import { login } from './helpers'

test('an admin invite lets a new user register, then gates them until Telegram is linked', async ({
  page,
  browser,
}) => {
  const username = `e2e_${Date.now()}`
  const password = 'e2e-test-password-1'

  await login(page, ADMIN_USERNAME, ADMIN_PASSWORD)
  await page.goto('/admin')
  await page.getByRole('button', { name: 'New invite' }).click()
  await page.getByRole('button', { name: 'Create invite' }).click()

  const urlText = await page.getByRole('textbox', { name: 'Invite link' }).inputValue()
  const match = urlText.match(/\/invite\/([\w-]+)/)
  if (!match) throw new Error(`couldn't find an invite token in "${urlText}"`)
  const token = match[1]

  // The invited person is someone else entirely — a fresh, cookie-free context, not a
  // second tab sharing the admin's session.
  const guestContext = await browser.newContext()
  const guestPage = await guestContext.newPage()

  await guestPage.goto(`/invite/${token}`)
  await expect(guestPage.getByRole('heading', { name: /Welcome to/ })).toBeVisible()
  await guestPage.getByLabel('Username').fill(username)
  await guestPage.getByLabel('Password').fill(password)
  await guestPage.getByRole('button', { name: 'Create account' }).click()

  // Every account, including a brand-new one, is gated behind linking Telegram before it
  // can use the app (spec §5.1/§5.2) — no CI runner can drive a real Telegram client, so
  // the link itself is simulated at the DB layer (see db.ts) rather than through the bot.
  await expect(guestPage.getByRole('heading', { name: 'Connect Telegram' })).toBeVisible()

  linkTelegramForUser(username)

  // TelegramGate polls the current-user endpoint every 2s and routes into the app as soon
  // as telegram_linked flips server-side.
  await expect(guestPage.getByLabel('New note')).toBeVisible({ timeout: 10_000 })

  await guestContext.close()
})

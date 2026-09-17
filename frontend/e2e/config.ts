import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return values
  for (const rawLine of fs.readFileSync(filePath, 'utf-8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return values
}

// frontend/e2e/config.ts -> repo root is two levels up.
export const REPO_ROOT = path.resolve(__dirname, '../..')
const dotEnv = loadEnvFile(path.join(REPO_ROOT, '.env'))

export const POSTGRES_USER = process.env.POSTGRES_USER || dotEnv.POSTGRES_USER || 'nook'
export const POSTGRES_DB = process.env.POSTGRES_DB || dotEnv.POSTGRES_DB || 'nook'

// The seeded admin (see README "First login" / ADMIN_USERNAME+ADMIN_PASSWORD bootstrap).
// Tests that only need *an* authenticated, Telegram-linked account reuse it rather than
// registering a fresh user every time.
export const ADMIN_USERNAME =
  process.env.E2E_ADMIN_USERNAME || dotEnv.ADMIN_USERNAME || dotEnv.E2E_ADMIN_USERNAME || 'admin'
export const ADMIN_PASSWORD =
  process.env.E2E_ADMIN_PASSWORD || dotEnv.ADMIN_PASSWORD || dotEnv.E2E_ADMIN_PASSWORD || ''

if (!ADMIN_PASSWORD) {
  throw new Error(
    'e2e: no admin password found. Set ADMIN_PASSWORD in .env (bootstraps the account on ' +
      'first API start) or pass E2E_ADMIN_PASSWORD for an account that already exists.',
  )
}

import { execFileSync } from 'node:child_process'
import { POSTGRES_DB, POSTGRES_USER, REPO_ROOT } from './config'

/** Runs a SQL statement against the compose `db` service. Test-only: real Telegram
 * linking goes through the bot (see TelegramGate.tsx / README "Setting up the Telegram
 * bot"), which no CI runner can drive — so tests that need a linked account reach past
 * the UI here rather than skipping the precondition or faking a bot client. */
function runSql(sql: string): void {
  execFileSync(
    'docker',
    [
      'compose',
      'exec',
      '-T',
      'db',
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-U',
      POSTGRES_USER,
      '-d',
      POSTGRES_DB,
      '-c',
      sql,
    ],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  )
}

const USERNAME_RE = /^[a-z0-9_]{3,32}$/

/** Marks `username` as having linked Telegram, unblocking it past TelegramGate. Usernames
 * are restricted to the app's own registration pattern, so this is not a SQL-injection
 * concern despite the string interpolation. */
export function linkTelegramForUser(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new Error(`refusing to run SQL for unexpected username: ${username}`)
  }
  const fakeId = Math.floor(Math.random() * 1_000_000_000) + 1
  runSql(
    `UPDATE users SET telegram_user_id = ${fakeId}, telegram_chat_id = ${fakeId} ` +
      `WHERE username = '${username}';`,
  )
}

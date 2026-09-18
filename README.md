# Nook

Self-hosted notes + tasks, with a Telegram bot for reminders and quick task capture.
See [TECH_SPEC.md](TECH_SPEC.md) for the full specification and [docs/DECISIONS.md](docs/DECISIONS.md)
for implementation decisions left to the agent's discretion by the spec.

"Nook" is a working name, configured via the single `APP_NAME` environment variable
(see `.env.example`) so it can be renamed without touching code.

## Stack

- **Backend**: Python 3.12+, FastAPI, SQLAlchemy 2 (async) + PostgreSQL 16, Alembic, aiogram 3
- **Frontend**: React 19 + TypeScript + Vite, Tailwind CSS on custom CSS-variable design tokens,
  TanStack Query, Zustand, Radix UI, CodeMirror 6 (added in a later stage)
- **Infra**: Docker Compose (`db`, `api`, `worker`, `bot`, `web`)

## Quick start (Docker)

1. Copy the env template and fill in the values (at minimum a strong `SECRET_KEY`,
   Postgres credentials, and — once you've created a bot with
   [@BotFather](https://t.me/BotFather) — `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME`):
   ```bash
   cp .env.example .env
   ```
2. Start everything:
   ```bash
   docker compose up -d --build
   ```
3. The API applies Alembic migrations automatically on startup. If `ADMIN_USERNAME` and
   `ADMIN_PASSWORD` are set in `.env`, the first admin account is bootstrapped automatically
   the first time the `users` table is empty. Otherwise, create one manually:
   ```bash
   docker compose exec api python cli.py create-admin
   ```
4. Open `http://localhost:${WEB_PORT:-8080}` and sign in with the admin account from step 3.
   Every account, including admin, has to link Telegram before it can use the app — see
   "Setting up the Telegram bot" below.

## Updating

```bash
git pull
docker compose up -d --build
```

The `api` container runs `alembic upgrade head` on every start, so schema migrations apply
automatically. Nothing else needs a manual step.

## Backup and restore

```bash
./deploy/backup.sh
```

writes `backups/<timestamp>/db.dump` (a `pg_dump --format=custom` archive) and
`backups/<timestamp>/attachments.tar.gz` (everything in the attachments volume), with the
stack running. Run it on a schedule (e.g. a cron entry calling it) for regular backups — it
doesn't manage retention itself, so prune old snapshots under `backups/` however you'd like.

To restore into a stack that's already up:

```bash
# Database — --clean drops existing objects first, so this replaces current data.
cat backups/<timestamp>/db.dump | docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists

# Attachments
cat backups/<timestamp>/attachments.tar.gz | docker compose exec -T api tar xzf - -C /data/attachments
```

(`$POSTGRES_USER` / `$POSTGRES_DB` are the values from your `.env`.)

## HTTPS with Caddy

The `web` service only speaks plain HTTP. For a real deployment, put a reverse proxy in
front of it that terminates TLS — [Caddy](https://caddyserver.com/) does this with automatic
Let's Encrypt certificates and near-zero config. See
[`deploy/Caddyfile.example`](deploy/Caddyfile.example): copy it to `Caddyfile`, replace the
domain, and run Caddy (as a host service, or its own container) alongside the stack.

## Setting up the Telegram bot

Linking Telegram is mandatory (spec §5.1) — no part of the app is usable until it's connected,
including for the admin account. To test this locally:

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, and follow the
   prompts to get a bot token and username.
2. Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (without the `@`) in `.env`.
3. Restart the `bot` service (`docker compose up -d bot`, or the local `uv run python bot/main.py`
   process). It runs in long-polling mode by default (`BOT_MODE=polling`), so no public domain
   or webhook is needed.
4. Log in to the web app; the onboarding gate shows a QR code / deep link to `t.me/<your bot>`
   that finishes the link.

Without a token set, the bot process stays up but idle (logs a warning and does nothing), and the
web app's onboarding gate will show a QR code that doesn't go anywhere useful yet.

## Connecting an MCP client (Claude, ...)

Nook runs its own [MCP](https://modelcontextprotocol.io/) server (`app/mcp/` in the backend),
so an MCP client like Claude Desktop or Claude Code can read and write your notes and tasks
directly — list/search/create/edit notes, list/create/update/complete tasks, and so on.

1. In the web app, go to **Settings → API tokens → New token**, name it (e.g. "Claude
   Desktop"), and copy the token shown — it's only displayed once.
2. Add a remote MCP connector in your client pointing at `<your Nook URL>/mcp` (e.g.
   `http://localhost:8080/mcp`), authenticating with that token as a bearer token.

Each token is a personal access token scoped to your account only — a client using it can
only ever see and change your own notes and tasks, the same isolation the web app itself
enforces. Revoke a token from the same Settings page at any time; nothing else is affected.

## Local development (without Docker)

**Backend** (requires [uv](https://docs.astral.sh/uv/) and a local PostgreSQL 16):

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Run checks:

```bash
uv run ruff check .
uv run ruff format --check .
uv run mypy app cli.py worker bot
uv run pytest
```

**Frontend** (requires Node 22+ and [pnpm](https://pnpm.io/)):

```bash
cd frontend
pnpm install
pnpm run dev
```

Run checks:

```bash
pnpm run lint
pnpm run format:check
pnpm run typecheck
pnpm run test
pnpm run build
```

In development, `/styleguide` shows every design token and base component in both themes.

## End-to-end tests

`frontend/e2e/` has Playwright tests for the key user-facing flows (invite → register →
Telegram gate, wikilink → backlink, quick add → Today). They run against a fully running
stack, not a mocked one, so start it first:

```bash
docker compose up -d --build
```

Then, with `ADMIN_USERNAME` / `ADMIN_PASSWORD` set in `.env` (bootstrapped on first start —
see "Quick start" above):

```bash
cd frontend
pnpm exec playwright install --with-deps chromium   # once
pnpm run e2e
```

Real Telegram linking can't be driven from a test (there's no way to script a Telegram
client), so tests that need a linked account set `telegram_user_id`/`telegram_chat_id`
directly in the database (`frontend/e2e/db.ts`) rather than skipping that precondition —
only the onboarding test asserts the gate itself actually appears first.

Point `E2E_BASE_URL` at a different origin (e.g. the Vite dev server) if you're not running
against the Docker Compose stack, and `E2E_ADMIN_USERNAME`/`E2E_ADMIN_PASSWORD` if the
admin account's credentials aren't in `.env`.

## Repository layout

```
backend/app/        FastAPI app: api/v1 routers, core (config/db/security), models, schemas, services
backend/app/mcp/     MCP server (notes/tasks tools for an MCP client, mounted at /mcp)
backend/worker/      Reminder delivery worker (asyncio loop, no Redis/Celery)
backend/bot/         Telegram bot (aiogram 3)
backend/alembic/     Database migrations
backend/tests/       Pytest suite
frontend/src/app/     Routing and providers
frontend/src/design/  Design tokens and base components
frontend/src/features/ Feature modules (notes, tasks, auth, graph, search, ...)
frontend/src/lib/     API client and utilities
frontend/e2e/          Playwright end-to-end tests
deploy/               nginx config, Caddy example, backup script
docs/                 Decisions log and other project docs
```

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
4. Open `http://localhost:${WEB_PORT:-8080}`.

Further setup (bot linking, backups, HTTPS via Caddy) is documented as those pieces land —
see the stage roadmap in `docs/DECISIONS.md` and the project's plan for what's implemented so far.

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

## Repository layout

```
backend/app/        FastAPI app: api/v1 routers, core (config/db/security), models, schemas, services
backend/worker/      Reminder delivery worker (asyncio loop, no Redis/Celery)
backend/bot/         Telegram bot (aiogram 3)
backend/alembic/     Database migrations
backend/tests/       Pytest suite
frontend/src/app/     Routing and providers
frontend/src/design/  Design tokens and base components
frontend/src/features/ Feature modules (notes, tasks, auth, graph, search, ...)
frontend/src/lib/     API client and utilities
deploy/               nginx config, Caddy example, backup script
docs/                 Decisions log and other project docs
```

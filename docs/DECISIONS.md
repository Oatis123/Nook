# Decisions

One line per decision left to the agent's discretion by TECH_SPEC.md, in the format:
`YYYY-MM-DD — decision — reason`.

- 2026-09-17 — Working name "Nook" is exposed as a single `APP_NAME` env var (see `.env.example`), read by frontend/backend/bot so it can be renamed without code changes — spec §0 requires this.
- 2026-09-17 — Python tooling: `uv` for dependency management, `ruff` for lint/format, `mypy` for types — faster and simpler than Poetry, single static binary, current ecosystem default.
- 2026-09-17 — Frontend package manager: `pnpm` — fast, disk-efficient installs, standard for modern Vite/TS projects.
- 2026-09-17 — Global/local note graph rendered with `react-force-graph-2d` (wraps d3-force + canvas) instead of a hand-rolled d3-force/canvas renderer or sigma.js — production-proven canvas performance at 2000+ nodes without spending implementation time on a custom renderer.
- 2026-09-17 — Calendar view is a custom implementation on top of `date-fns` rather than FullCalendar — spec prefers this explicitly; avoids fighting FullCalendar's CSS to match the design system.
- 2026-09-17 — Full-text search: `notes` gets two generated `tsvector` columns (`search_vector_en` using the `english` config, `search_vector_ru` using `russian`), queried with OR; a `pg_trgm` GIN index on `notes.title` powers fuzzy quick-switcher matching — correct stemming for both languages without extra services.
- 2026-09-17 — Fonts (all self-hosted via `@fontsource`, no Google Fonts CDN): headings/note titles — Literata (serif); interface — IBM Plex Sans (humanist sans); editor/code — JetBrains Mono.
- 2026-09-17 — Reminder delivery worker is a plain asyncio loop (30s tick, `SELECT ... FOR UPDATE SKIP LOCKED`) with no Redis/Celery — spec §8.4 mandates this explicitly.
- 2026-09-17 — Recurrence stored as an RFC 5545 RRULE string (`python-dateutil.rrule` for expansion) plus `dtstart_local` and the user's IANA timezone, per spec §7.4/§11.
- 2026-09-17 — The no-flash theme bootstrap script is a same-origin external file (`public/theme-init.js`, classic non-module `<script src>`) rather than an inline `<script>` — lets nginx's CSP use `script-src 'self'` with no `'unsafe-inline'`/nonce exception while still running synchronously before first paint.
- 2026-09-17 — nginx CSP (`deploy/nginx.conf.template`) allows `style-src 'unsafe-inline'` only — Radix UI primitives set inline `style` for computed popover/tooltip/menu positioning, which can't be pre-hashed; `script-src` stays `'self'` with no exception. Inline style injection is a much smaller attack surface than inline script.
- 2026-09-17 — Local dev machine has neither Docker nor a local PostgreSQL install. Docker Compose/Dockerfiles are still written and kept correct per spec. Stage-by-stage verification during development uses native `uv run` (ruff, mypy, `pytest --collect-only` plus any DB-free unit tests) and `pnpm` (eslint, tsc, vitest) instead of `docker compose up`. Tests that require a live Postgres run in GitHub Actions CI (service container) and should additionally be verified by the user via `docker compose up` where Docker is available.

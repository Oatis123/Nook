# Deploying Nook on a server

A step-by-step guide for running Nook on a VPS with its own domain and HTTPS. Stack:
Docker Compose (`db`, `api`, `worker`, `bot`, `web`) plus a `caddy` container that
obtains Let's Encrypt certificates automatically.

Tested setup: any Linux VPS with 1–2 GB RAM, Docker Engine 24+ with the Compose plugin
(2.24+), a domain whose DNS `A` (and `AAAA`, if you use IPv6) record points at the server.

## 1. Prepare the server

```bash
# Firewall: SSH plus HTTP/HTTPS only. Nothing else needs to be reachable —
# Postgres and the API are never published, and with Caddy nginx isn't either.
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp   # HTTP/3
sudo ufw enable

git clone <your fork of this repo> /opt/nook
cd /opt/nook
```

> Docker publishes ports by writing its own iptables rules, which bypass ufw. That's why
> the HTTPS setup below doesn't publish nginx's port at all rather than relying on the
> firewall to hide it.

## 2. Configure `.env`

```bash
cp .env.example .env
chmod 600 .env
```

Fill in at least:

| Variable | Value |
|---|---|
| `SECRET_KEY` | output of `openssl rand -hex 32` — the API refuses to start without a strong key |
| `POSTGRES_USER`, `POSTGRES_DB` | e.g. `nook` |
| `POSTGRES_PASSWORD` | output of `openssl rand -hex 24` |
| `ADMIN_USERNAME` | not `admin` — a name that's hard to guess |
| `ADMIN_PASSWORD` | a long unique password (10+ characters, otherwise no admin is created — check `docker compose logs api`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME` | from [@BotFather](https://t.me/BotFather) (see README) |

Then enable HTTPS by adding:

```dotenv
COMPOSE_FILE=docker-compose.yml:docker-compose.caddy.yml
DOMAIN=notes.example.com
PUBLIC_URL=https://notes.example.com
TRUSTED_PROXY_CIDR=172.30.0.10/32
```

- `COMPOSE_FILE` makes every `docker compose` command include the Caddy setup, so you
  never have to pass `-f` flags.
- `TRUSTED_PROXY_CIDR` is the fixed address of the Caddy container
  (`docker-compose.caddy.yml`). nginx trusts `X-Forwarded-For` from it only, so the API
  sees the visitor's real IP — login rate limiting and the session list depend on that.
- Optional: `MAX_UPLOAD_MB` (per file), `MAX_IMPORT_MB` (vault import archive),
  `MAX_STORAGE_MB` (attachments per user, `0` = unlimited), `*_MEM_LIMIT` for each
  service (see `docker-compose.yml`).

## 3. Start

```bash
docker compose up -d --build
docker compose ps          # all services should become "healthy"
docker compose logs -f caddy   # watch the certificate being issued
```

Open `https://<your domain>`, sign in with the admin account and link Telegram (the app
requires it for every account). HTTP requests are redirected to HTTPS; cookies are
`Secure`, so signing in only works over HTTPS.

Quick checks:

- `curl -sI https://<domain> | grep -i strict-transport` shows the HSTS header.
- `curl -s http://<server-ip>:8080` from another machine fails (port not published).
- Settings → Sessions shows your real IP, not a `172.x` address.
- <https://securityheaders.com> gives the site an A.

## 4. Backups

`deploy/backup.sh` writes a PostgreSQL dump (`nook-db-<date>.dump`) and an archive of
all attachments (`nook-attachments-<date>.tar.gz`) to `./backups`, keeping the newest 14
of each. Settings (environment variables):

- `BACKUP_DIR` — target directory (default `./backups`)
- `BACKUP_KEEP` — how many of each to keep (default `14`)
- `BACKUP_RSYNC_TARGET` — optional off-server copy, e.g. `backup@nas:/srv/nook/`
  (needs `rsync` and SSH key access). **Keep a copy off the server** — a backup on the
  same disk doesn't survive losing the server.

Run it daily from cron (`crontab -e` as a user that can run `docker`):

```cron
15 3 * * * cd /opt/nook && BACKUP_RSYNC_TARGET=backup@nas:/srv/nook/ deploy/backup.sh >> /var/log/nook-backup.log 2>&1
```

The `.env` file isn't in the backup — store a copy of it (it holds `SECRET_KEY` and the
database password) somewhere safe, like a password manager.

## 5. Restoring

```bash
deploy/restore.sh backups/nook-db-<date>.dump backups/nook-attachments-<date>.tar.gz
```

It asks for confirmation, stops the app, **replaces** the database and attachments with
the backup, fixes file ownership and starts everything again. Anything written after the
backup is lost.

Practice this once before you rely on it: restore the latest backup on a test machine
(or on the server right after taking a backup) and check that notes and attachments are
there.

## 6. Updating

```bash
cd /opt/nook
deploy/backup.sh            # always back up before an update
git pull
docker compose up -d --build
```

Database migrations run automatically when the `api` container starts.

## 7. Operations

- Logs: `docker compose logs -f api worker bot` (rotated automatically, 5 × 10 MB per
  service).
- Health: `docker compose ps`. The API's healthcheck includes a database query; the
  worker and bot report liveness through a heartbeat file.
- Memory: each service has a memory limit (`API_MEM_LIMIT`, `WORKER_MEM_LIMIT`, …), so
  one runaway container can't take the whole server down.
- A vault import interrupted by a restart is marked as failed on the next worker start —
  upload the archive again.

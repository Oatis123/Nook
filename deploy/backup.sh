#!/usr/bin/env bash
# Backs up the Postgres database and the attachments volume into ./backups/<timestamp>/.
# Run from the project root (where docker-compose.yml and .env live), with the stack up:
#
#   ./deploy/backup.sh
#
# Restore instructions are in README.md ("Backup and restore").
set -euo pipefail

# Stops Git Bash (MSYS) on Windows from rewriting the container-side /data/attachments
# path below into a host Windows path before it reaches `docker compose exec`. A no-op
# everywhere else.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "error: .env not found. Run this from the Nook project root." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

timestamp="$(date +%Y%m%d-%H%M%S)"
out_dir="backups/${timestamp}"
mkdir -p "$out_dir"

echo "Backing up database..."
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --format=custom \
  >"${out_dir}/db.dump"

echo "Backing up attachments..."
# Tar from inside the api container (it already mounts the attachments volume at this
# path) rather than resolving the volume's compose-project-prefixed name on the host.
docker compose exec -T api tar czf - -C /data/attachments . >"${out_dir}/attachments.tar.gz"

echo "Backup complete: ${out_dir}/"
ls -lh "${out_dir}"

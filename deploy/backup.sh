#!/usr/bin/env bash
# Backs up Nook: a PostgreSQL dump plus an archive of the attachments volume, with the
# date in the file names, keeping the newest $BACKUP_KEEP of each. Run from anywhere on
# the host (it cds to the repo); schedule it with cron — see docs/DEPLOY.md.
#
#   BACKUP_DIR=./backups   where to write (relative to the repo root, or absolute)
#   BACKUP_KEEP=14         how many backups of each kind to keep
#   BACKUP_RSYNC_TARGET=   optional off-host copy, e.g. user@backup-host:/srv/nook/
set -euo pipefail
# Dumps contain every note and the password hashes: readable by the owner only.
umask 077

cd "$(dirname "$0")/.."
BACKUP_DIR=${BACKUP_DIR:-./backups}
BACKUP_KEEP=${BACKUP_KEEP:-14}
stamp=$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP_DIR"

db_file="$BACKUP_DIR/nook-db-$stamp.dump"
files_file="$BACKUP_DIR/nook-attachments-$stamp.tar.gz"

echo "[$(date -Is)] backing up database → $db_file"
# Custom format (-Fc): compressed, and restorable with pg_restore (see restore.sh).
# Written to a .partial file first so a failed run never looks like a good backup.
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$db_file.partial"
mv "$db_file.partial" "$db_file"

echo "[$(date -Is)] backing up attachments → $files_file"
docker compose exec -T api tar -C /data/attachments -czf - . > "$files_file.partial"
mv "$files_file.partial" "$files_file"

prune() {
    # Newest first; everything after the first $BACKUP_KEEP goes.
    find "$BACKUP_DIR" -maxdepth 1 -name "$1" -type f -printf '%T@ %p\n' \
        | sort -rn | tail -n +"$((BACKUP_KEEP + 1))" | cut -d' ' -f2- \
        | while read -r old; do rm -f -- "$old"; done
}
prune 'nook-db-*.dump'
prune 'nook-attachments-*.tar.gz'

if [ -n "${BACKUP_RSYNC_TARGET:-}" ]; then
    echo "[$(date -Is)] copying backups to $BACKUP_RSYNC_TARGET"
    rsync -a --delete --include='nook-*' --exclude='*' "$BACKUP_DIR"/ "$BACKUP_RSYNC_TARGET"
fi

echo "[$(date -Is)] done: $(du -h "$db_file" | cut -f1) database, $(du -h "$files_file" | cut -f1) attachments"

#!/usr/bin/env bash
# Restores Nook from files made by deploy/backup.sh. REPLACES the current database and
# attachments — everything written since the backup is lost.
#
#   deploy/restore.sh backups/nook-db-<stamp>.dump [backups/nook-attachments-<stamp>.tar.gz]
#
# Add --yes to skip the confirmation prompt.
set -euo pipefail

cd "$(dirname "$0")/.."

assume_yes=false
args=()
for arg in "$@"; do
    if [ "$arg" = "--yes" ]; then assume_yes=true; else args+=("$arg"); fi
done
if [ "${#args[@]}" -lt 1 ] || [ "${#args[@]}" -gt 2 ]; then
    sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
fi
db_file=${args[0]}
files_file=${args[1]:-}
for f in "$db_file" ${files_file:+"$files_file"}; do
    [ -f "$f" ] || { echo "No such file: $f" >&2; exit 1; }
done

if ! $assume_yes; then
    echo "This replaces the current database${files_file:+ and all attachments} with:"
    echo "  $db_file"
    [ -n "$files_file" ] && echo "  $files_file"
    read -r -p "Type 'restore' to continue: " answer
    [ "$answer" = "restore" ] || { echo "Aborted."; exit 1; }
fi

# Check the backup files are readable *before* anything is deleted — a truncated or
# corrupt backup must not leave you with neither the old data nor the new.
echo "Checking the backup files…"
docker compose exec -T db pg_restore --list > /dev/null < "$db_file" \
    || { echo "The database dump can't be read — nothing was changed." >&2; exit 1; }
if [ -n "$files_file" ] && ! { gzip -t "$files_file" && tar -tzf "$files_file" > /dev/null; }; then
    echo "The attachments archive can't be read — nothing was changed." >&2
    exit 1
fi

echo "Stopping the app (the database keeps running)…"
docker compose stop web api worker bot

echo "Restoring the database…"
docker compose exec -T db sh -c \
    'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec -T db sh -c \
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error --single-transaction' < "$db_file"

if [ -n "$files_file" ]; then
    echo "Restoring attachments…"
    # Runs as root in a one-off api container (the entrypoint would drop privileges),
    # then hands the files back to the unprivileged app user.
    docker compose run --rm -T --no-deps --entrypoint sh api -c \
        'find /data/attachments -mindepth 1 -delete && tar -xzf - -C /data/attachments && chown -R app:app /data/attachments' \
        < "$files_file"
fi

echo "Starting the app…"
docker compose up -d
echo "Restore complete. Check the app, then take a fresh backup."

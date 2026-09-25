#!/bin/sh
# Runs as root only long enough to make the attachments volume writable by the
# unprivileged app user (volumes created by older images are owned by root), then
# drops privileges for the actual process.
set -e
if [ "$(id -u)" = "0" ]; then
    if [ -d /data/attachments ] && [ "$(stat -c %u /data/attachments)" != "$(id -u app)" ]; then
        chown -R app:app /data/attachments
    fi
    exec setpriv --reuid=app --regid=app --init-groups "$@"
fi
exec "$@"

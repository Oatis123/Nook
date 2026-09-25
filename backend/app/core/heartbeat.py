"""File-based liveness for the long-running processes that have no HTTP port (worker,
bot): the process touches a file from its main loop, and the compose healthcheck runs
`python -m app.core.heartbeat <path> <max_age_seconds>` to see whether it's still fresh."""

import contextlib
import sys
import time
from pathlib import Path

WORKER_HEARTBEAT = Path("/tmp/nook-worker.heartbeat")
BOT_HEARTBEAT = Path("/tmp/nook-bot.heartbeat")


def beat(path: Path) -> None:
    with contextlib.suppress(OSError):
        path.touch()


def is_fresh(path: Path, max_age_seconds: float) -> bool:
    try:
        return time.time() - path.stat().st_mtime <= max_age_seconds
    except OSError:
        return False


if __name__ == "__main__":
    sys.exit(0 if is_fresh(Path(sys.argv[1]), float(sys.argv[2])) else 1)

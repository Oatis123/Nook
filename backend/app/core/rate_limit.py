import time
from collections import defaultdict

MAX_ATTEMPTS = 5
WINDOW_SECONDS = 15 * 60

# In-process sliding-window counter. Spec explicitly rules out Redis/Celery (§8.4) and
# the app is meant to run as a single API process, so process-local state is sufficient;
# it resets on restart/deploy, which is acceptable for a login brute-force guard.
_attempts: dict[str, list[float]] = defaultdict(list)


def _key(username: str, ip: str) -> str:
    return f"{username}:{ip}"


def is_rate_limited(username: str, ip: str) -> bool:
    now = time.monotonic()
    key = _key(username, ip)
    attempts = [t for t in _attempts[key] if now - t < WINDOW_SECONDS]
    _attempts[key] = attempts
    return len(attempts) >= MAX_ATTEMPTS


def record_attempt(username: str, ip: str) -> None:
    _attempts[_key(username, ip)].append(time.monotonic())


def reset_attempts(username: str, ip: str) -> None:
    _attempts.pop(_key(username, ip), None)


def reset_all() -> None:
    """Test-only: clears all rate-limit state between test cases."""
    _attempts.clear()

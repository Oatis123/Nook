import time
from collections import OrderedDict, deque

# In-process sliding-window counters. Spec explicitly rules out Redis/Celery (§8.4) and
# the app is meant to run as a single API process, so process-local state is sufficient;
# it resets on restart/deploy, which is acceptable for a brute-force guard.


class SlidingWindowLimiter:
    """At most `limit` hits per `window_seconds` per key.

    `hit()` records the attempt and answers in one synchronous step — there is no await
    between checking and recording, so a burst of concurrent requests can't all pass the
    check before any of them is counted. The key table is bounded (least recently used
    keys are evicted) so a flood of distinct usernames can't grow memory without limit.
    """

    def __init__(self, limit: int, window_seconds: float, max_keys: int = 50_000) -> None:
        self.limit = limit
        self.window = window_seconds
        self.max_keys = max_keys
        self._hits: OrderedDict[str, deque[float]] = OrderedDict()

    def _recent(self, key: str, now: float) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            hits = deque()
            self._hits[key] = hits
            while len(self._hits) > self.max_keys:
                self._hits.popitem(last=False)
        else:
            self._hits.move_to_end(key)
        while hits and now - hits[0] >= self.window:
            hits.popleft()
        return hits

    def hit(self, key: str) -> bool:
        """Records an attempt; False if the key was already over its limit."""
        now = time.monotonic()
        hits = self._recent(key, now)
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def clear(self) -> None:
        self._hits.clear()


# Spec §5.4: 5 login attempts / 15 minutes per username+IP.
login_attempts = SlidingWindowLimiter(limit=5, window_seconds=15 * 60)
# Across all usernames from one IP — stops spraying passwords over many accounts.
login_attempts_per_ip = SlidingWindowLimiter(limit=30, window_seconds=15 * 60)
# Anonymous "log in with Telegram" requests (each one stores a token row).
telegram_login_tokens_per_ip = SlidingWindowLimiter(limit=10, window_seconds=15 * 60)
# Current-password checks when changing password / relinking Telegram, per user.
password_checks_per_user = SlidingWindowLimiter(limit=5, window_seconds=15 * 60)

_ALL = (
    login_attempts,
    login_attempts_per_ip,
    telegram_login_tokens_per_ip,
    password_checks_per_user,
)


def reset_all() -> None:
    """Test-only: clears all rate-limit state between test cases."""
    for limiter in _ALL:
        limiter.clear()

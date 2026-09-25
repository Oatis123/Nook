import asyncio
import weakref

import anyio
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except VerifyMismatchError:
        return False


# A real argon2 hash of a random throwaway password: verifying against it costs the same
# as a real check, so "no such user" can't be told apart from "wrong password" by timing.
_DUMMY_HASH = _hasher.hash("nook-timing-equalizer-not-a-real-password")


# argon2 is deliberately expensive: ~70 ms and 64 MiB of RAM per hash. It runs off the
# event loop (so logins don't freeze other requests), but at most this many at once —
# unbounded, a burst of anonymous login attempts ran dozens in parallel and pushed the
# API past its memory limit. Extra attempts just queue.
MAX_CONCURRENT_HASHES = 4
_limiters: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, anyio.CapacityLimiter]" = (
    weakref.WeakKeyDictionary()
)


def _hash_limiter() -> anyio.CapacityLimiter:
    # One limiter per event loop (a limiter is bound to the loop it's created in).
    loop = asyncio.get_running_loop()
    limiter = _limiters.get(loop)
    if limiter is None:
        limiter = anyio.CapacityLimiter(MAX_CONCURRENT_HASHES)
        _limiters[loop] = limiter
    return limiter


async def hash_password_async(plain: str) -> str:
    return await anyio.to_thread.run_sync(hash_password, plain, limiter=_hash_limiter())


async def verify_password_async(plain: str, hashed: str | None) -> bool:
    if hashed is None:
        await anyio.to_thread.run_sync(verify_password, plain, _DUMMY_HASH, limiter=_hash_limiter())
        return False
    return await anyio.to_thread.run_sync(verify_password, plain, hashed, limiter=_hash_limiter())

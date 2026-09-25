from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from starlette.concurrency import run_in_threadpool

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


async def hash_password_async(plain: str) -> str:
    """argon2 is deliberately slow (~70 ms, 64 MiB) — off the event loop, so a burst of
    logins doesn't freeze every other request."""
    return await run_in_threadpool(hash_password, plain)


async def verify_password_async(plain: str, hashed: str | None) -> bool:
    if hashed is None:
        await run_in_threadpool(verify_password, plain, _DUMMY_HASH)
        return False
    return await run_in_threadpool(verify_password, plain, hashed)

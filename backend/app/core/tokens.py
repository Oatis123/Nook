import hashlib
import secrets


def generate_token() -> str:
    """A high-entropy, URL-safe opaque token (invites, auth tokens, refresh tokens)."""
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    """SHA-256 is fine here (not argon2): these are random 256-bit tokens, not user
    passwords, so there is no brute-force risk to slow down against."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

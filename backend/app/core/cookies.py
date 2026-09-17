from fastapi import Response

from app.core.config import Settings, get_settings
from app.core.tokens import generate_token

ACCESS_COOKIE = "access_token"
REFRESH_COOKIE = "refresh_token"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"


def _secure(settings: Settings) -> bool:
    return settings.environment == "production"


def set_access_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        ACCESS_COOKIE,
        token,
        max_age=settings.access_token_ttl_minutes * 60,
        httponly=True,
        secure=_secure(settings),
        samesite="lax",
        path="/",
    )


def set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_ttl_days * 24 * 60 * 60,
        httponly=True,
        secure=_secure(settings),
        samesite="lax",
        path="/api/v1/auth",
    )


def ensure_csrf_cookie(request_cookie: str | None, response: Response) -> str:
    """Double-submit CSRF: issue a readable (non-httpOnly) token if the client doesn't
    have one yet, so it can be echoed back in a header on state-changing requests."""
    settings = get_settings()
    token = request_cookie or generate_token()
    if not request_cookie:
        response.set_cookie(
            CSRF_COOKIE,
            token,
            httponly=False,
            secure=_secure(settings),
            samesite="lax",
            path="/",
        )
    return token


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/api/v1/auth")

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.core.cookies import (
    REFRESH_COOKIE,
    clear_auth_cookies,
    set_access_cookie,
    set_refresh_cookie,
)
from app.core.deps import CurrentUser, DbSession, require_csrf
from app.core.isolation import get_owned_or_404
from app.core.jwt import create_access_token
from app.core.tokens import hash_token
from app.models.refresh_token import RefreshToken
from app.schemas.auth import LoginRequest, SessionOut
from app.schemas.invite import InviteAcceptRequest, InvitePreview
from app.schemas.telegram import TelegramLoginStatusIn, TelegramLoginStatusOut, TelegramTokenOut
from app.schemas.user import UserPublic
from app.services import auth as auth_service
from app.services import invites as invites_service
from app.services import password_reset as password_reset_service
from app.services import telegram_link as telegram_link_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _start_session(
    session: DbSession, response: Response, user_id: uuid.UUID, role: str, request: Request
) -> None:
    access_token = create_access_token(user_id, role)
    refresh_token = await auth_service.issue_refresh_token(
        session, user_id, request.headers.get("user-agent"), _client_ip(request)
    )
    set_access_cookie(response, access_token)
    set_refresh_cookie(response, refresh_token)


@router.post("/login", response_model=UserPublic, dependencies=[Depends(require_csrf)])
async def login(
    body: LoginRequest, request: Request, response: Response, session: DbSession
) -> UserPublic:
    user = await auth_service.authenticate(
        session, body.username, body.password, _client_ip(request)
    )
    await _start_session(session, response, user.id, user.role.value, request)
    return UserPublic.from_user(user)


@router.post(
    "/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)]
)
async def logout(request: Request, response: Response, session: DbSession) -> None:
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if refresh_token:
        await auth_service.revoke_refresh_token(session, refresh_token)
    clear_auth_cookies(response)


@router.post("/refresh", response_model=UserPublic, dependencies=[Depends(require_csrf)])
async def refresh(request: Request, response: Response, session: DbSession) -> UserPublic:
    refresh_token = request.cookies.get(REFRESH_COOKIE)
    if not refresh_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")

    user, new_refresh_token = await auth_service.rotate_refresh_token(
        session, refresh_token, request.headers.get("user-agent"), _client_ip(request)
    )
    access_token = create_access_token(user.id, user.role.value)
    set_access_cookie(response, access_token)
    set_refresh_cookie(response, new_refresh_token)
    return UserPublic.from_user(user)


@router.get("/invite/{token}", response_model=InvitePreview)
async def preview_invite(token: str, session: DbSession) -> InvitePreview:
    invite = await invites_service.get_active_invite_by_token(session, token)
    return InvitePreview(comment=invite.comment, expires_at=invite.expires_at)


@router.post("/invite/accept", response_model=UserPublic, dependencies=[Depends(require_csrf)])
async def accept_invite(
    body: InviteAcceptRequest, request: Request, response: Response, session: DbSession
) -> UserPublic:
    user = await invites_service.accept_invite(
        session, body.token, body.username, body.password, body.timezone
    )
    await _start_session(session, response, user.id, user.role.value, request)
    return UserPublic.from_user(user)


class PasswordResetConsume(BaseModel):
    new_password: str


@router.post("/password-reset/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def consume_password_reset(
    token: str, body: PasswordResetConsume, session: DbSession
) -> None:
    await password_reset_service.consume_reset_token(session, token, body.new_password)


@router.post(
    "/telegram/login-token", response_model=TelegramTokenOut, dependencies=[Depends(require_csrf)]
)
async def create_telegram_login_token(request: Request, session: DbSession) -> TelegramTokenOut:
    plain, expires_at = await telegram_link_service.create_login_token(
        session, request.headers.get("user-agent"), _client_ip(request)
    )
    return TelegramTokenOut(
        deep_link_url=telegram_link_service.deep_link_url("login", plain), expires_at=expires_at
    )


@router.post(
    "/telegram/login-status",
    response_model=TelegramLoginStatusOut,
    dependencies=[Depends(require_csrf)],
)
async def telegram_login_status(
    body: TelegramLoginStatusIn, request: Request, response: Response, session: DbSession
) -> TelegramLoginStatusOut:
    poll_status, user = await telegram_link_service.claim_login_token(session, body.token)
    if poll_status == "confirmed" and user is not None:
        await _start_session(session, response, user.id, user.role.value, request)
        return TelegramLoginStatusOut(status="confirmed", user=UserPublic.from_user(user))
    return TelegramLoginStatusOut(status=poll_status)


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    request: Request, user: CurrentUser, session: DbSession
) -> list[SessionOut]:
    current_token = request.cookies.get(REFRESH_COOKIE)
    current_hash = hash_token(current_token) if current_token else None
    sessions = await auth_service.list_sessions(session, user.id)
    return [
        SessionOut(
            id=s.id,
            user_agent=s.user_agent,
            ip=s.ip,
            created_at=s.created_at,
            expires_at=s.expires_at,
            is_current=(s.token_hash == current_hash),
        )
        for s in sessions
    ]


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_csrf)],
)
async def revoke_session(session_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    token = await get_owned_or_404(session, RefreshToken, session_id, user.id)
    token.revoked_at = datetime.now(UTC)
    await session.commit()


@router.delete(
    "/sessions", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)]
)
async def revoke_all_sessions_endpoint(
    response: Response, user: CurrentUser, session: DbSession
) -> None:
    await auth_service.revoke_all_sessions(session, user.id)
    clear_auth_cookies(response)

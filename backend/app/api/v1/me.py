from fastapi import APIRouter, Depends, Request, status

from app.core.cookies import REFRESH_COOKIE
from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.telegram import TelegramReauth, TelegramTokenOut
from app.schemas.user import MeUpdate, PasswordChange, UserPublic
from app.services import admin as admin_service
from app.services import me as me_service
from app.services import telegram_link as telegram_link_service

router = APIRouter(prefix="/me", tags=["me"])


@router.get("", response_model=UserPublic)
async def get_me(user: CurrentUser) -> UserPublic:
    return UserPublic.from_user(user)


@router.patch("", response_model=UserPublic, dependencies=[Depends(require_csrf)])
async def update_me(body: MeUpdate, user: CurrentUser, session: DbSession) -> UserPublic:
    updated = await me_service.update_profile(session, user, body)
    return UserPublic.from_user(updated)


@router.post(
    "/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)]
)
async def change_password(
    body: PasswordChange, request: Request, user: CurrentUser, session: DbSession
) -> None:
    current_refresh_token = request.cookies.get(REFRESH_COOKIE)
    await me_service.change_password(
        session, user, body.current_password, body.new_password, current_refresh_token
    )


@router.post(
    "/telegram/link-token", response_model=TelegramTokenOut, dependencies=[Depends(require_csrf)]
)
async def create_telegram_link_token(
    user: CurrentUser, session: DbSession, body: TelegramReauth | None = None
) -> TelegramTokenOut:
    if user.telegram_user_id is not None:
        await me_service.check_current_password(user, (body.current_password if body else "") or "")
    plain, expires_at = await telegram_link_service.create_link_token(session, user.id)
    return TelegramTokenOut(
        deep_link_url=telegram_link_service.deep_link_url("link", plain), expires_at=expires_at
    )


@router.post("/telegram/unlink", response_model=UserPublic, dependencies=[Depends(require_csrf)])
async def unlink_telegram(
    user: CurrentUser, session: DbSession, body: TelegramReauth | None = None
) -> UserPublic:
    await me_service.check_current_password(user, (body.current_password if body else "") or "")
    updated = await admin_service.unlink_telegram(session, user.id)
    return UserPublic.from_user(updated)

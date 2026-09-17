from fastapi import APIRouter, Depends, Request, status

from app.core.cookies import REFRESH_COOKIE
from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.user import MeUpdate, PasswordChange, UserPublic
from app.services import me as me_service

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

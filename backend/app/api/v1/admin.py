import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.deps import AdminUser, DbSession, require_csrf
from app.models.invite import Invite
from app.models.user import UserRole
from app.schemas.invite import InviteCreate, InviteCreateOut, InviteOut
from app.schemas.user import AdminUserOut
from app.services import admin as admin_service
from app.services import invites as invites_service
from app.services import password_reset as password_reset_service
from app.services.invites import invite_status

router = APIRouter(prefix="/admin", tags=["admin"])

Csrf = Depends(require_csrf)


def _invite_out(invite: Invite) -> InviteOut:
    return InviteOut(
        id=invite.id,
        comment=invite.comment,
        status=invite_status(invite),
        expires_at=invite.expires_at,
        used_by_username=invite.used_by_user.username if invite.used_by_user else None,
        used_at=invite.used_at,
        revoked_at=invite.revoked_at,
        created_at=invite.created_at,
    )


@router.get("/invites", response_model=list[InviteOut])
async def list_invites(_admin: AdminUser, session: DbSession) -> list[InviteOut]:
    invites = await invites_service.list_invites(session)
    return [_invite_out(i) for i in invites]


@router.post("/invites", response_model=InviteCreateOut, dependencies=[Csrf])
async def create_invite(
    body: InviteCreate, admin: AdminUser, session: DbSession
) -> InviteCreateOut:
    invite, plain = await invites_service.create_invite(
        session, admin.id, body.comment, body.expires_in_days
    )
    settings = get_settings()
    invite_url = f"{settings.public_url.rstrip('/')}/invite/{plain}"
    return InviteCreateOut(**_invite_out(invite).model_dump(), invite_url=invite_url)


@router.post("/invites/{invite_id}/revoke", response_model=InviteOut, dependencies=[Csrf])
async def revoke_invite(invite_id: uuid.UUID, _admin: AdminUser, session: DbSession) -> InviteOut:
    invite = await invites_service.revoke_invite(session, invite_id)
    return _invite_out(invite)


@router.get("/users", response_model=list[AdminUserOut])
async def list_users(_admin: AdminUser, session: DbSession) -> list[AdminUserOut]:
    users = await admin_service.list_users(session)
    return [AdminUserOut.from_user(u) for u in users]


@router.post("/users/{user_id}/activate", response_model=AdminUserOut, dependencies=[Csrf])
async def activate_user(user_id: uuid.UUID, _admin: AdminUser, session: DbSession) -> AdminUserOut:
    user = await admin_service.set_user_active(session, user_id, True)
    return AdminUserOut.from_user(user)


@router.post("/users/{user_id}/deactivate", response_model=AdminUserOut, dependencies=[Csrf])
async def deactivate_user(
    user_id: uuid.UUID, _admin: AdminUser, session: DbSession
) -> AdminUserOut:
    user = await admin_service.set_user_active(session, user_id, False)
    return AdminUserOut.from_user(user)


@router.post("/users/{user_id}/unlink-telegram", response_model=AdminUserOut, dependencies=[Csrf])
async def unlink_telegram(
    user_id: uuid.UUID, _admin: AdminUser, session: DbSession
) -> AdminUserOut:
    user = await admin_service.unlink_telegram(session, user_id)
    return AdminUserOut.from_user(user)


class RoleChange(BaseModel):
    role: UserRole


@router.post("/users/{user_id}/role", response_model=AdminUserOut, dependencies=[Csrf])
async def set_user_role(
    user_id: uuid.UUID, body: RoleChange, _admin: AdminUser, session: DbSession
) -> AdminUserOut:
    user = await admin_service.set_user_role(session, user_id, body.role)
    return AdminUserOut.from_user(user)


class ResetPasswordOut(BaseModel):
    reset_url: str


@router.post(
    "/users/{user_id}/reset-password", response_model=ResetPasswordOut, dependencies=[Csrf]
)
async def reset_password(
    user_id: uuid.UUID, _admin: AdminUser, session: DbSession
) -> ResetPasswordOut:
    settings = get_settings()
    plain = await password_reset_service.create_reset_token(session, user_id)
    return ResetPasswordOut(reset_url=f"{settings.public_url.rstrip('/')}/reset-password/{plain}")

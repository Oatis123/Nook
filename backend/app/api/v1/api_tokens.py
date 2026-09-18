import uuid

from fastapi import APIRouter, Depends, status

from app.core.deps import CurrentUser, DbSession, require_csrf
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreated, ApiTokenOut
from app.services import api_tokens as api_tokens_service

router = APIRouter(prefix="/me/api-tokens", tags=["api-tokens"])


@router.get("", response_model=list[ApiTokenOut])
async def list_api_tokens(user: CurrentUser, session: DbSession) -> list[ApiTokenOut]:
    tokens = await api_tokens_service.list_api_tokens(session, user.id)
    return [ApiTokenOut.model_validate(t) for t in tokens]


@router.post("", response_model=ApiTokenCreated, dependencies=[Depends(require_csrf)])
async def create_api_token(
    body: ApiTokenCreate, user: CurrentUser, session: DbSession
) -> ApiTokenCreated:
    token, plain = await api_tokens_service.create_api_token(session, user.id, body.name)
    return ApiTokenCreated(
        id=token.id,
        name=token.name,
        created_at=token.created_at,
        last_used_at=token.last_used_at,
        token=plain,
    )


@router.delete(
    "/{token_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_csrf)]
)
async def revoke_api_token(token_id: uuid.UUID, user: CurrentUser, session: DbSession) -> None:
    await api_tokens_service.revoke_api_token(session, user.id, token_id)

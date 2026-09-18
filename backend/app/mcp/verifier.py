from mcp.server.auth.provider import AccessToken, TokenVerifier

from app.core.db import async_session_factory
from app.services.api_tokens import resolve_api_token


class NookTokenVerifier(TokenVerifier):
    """Resolves a personal access token (Settings -> API tokens) to its owning user.

    Runs outside FastAPI's request scope (the MCP session manager owns its own request
    lifecycle), so it opens its own session rather than using the `DbSession` dependency —
    the same pattern the worker and bot already use for the same reason.
    """

    async def verify_token(self, token: str) -> AccessToken | None:
        async with async_session_factory() as session:
            user = await resolve_api_token(session, token)
        if user is None:
            return None
        return AccessToken(token=token, client_id=str(user.id), scopes=[], subject=str(user.id))

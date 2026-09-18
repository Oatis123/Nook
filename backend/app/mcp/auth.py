import uuid

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver.exceptions import ToolError


def current_user_id() -> uuid.UUID:
    """The user the caller's bearer token belongs to (set by `NookTokenVerifier` via the
    SDK's auth middleware). `RequireAuthMiddleware` already rejects any request without a
    valid token before a tool ever runs, so a missing subject here would mean the SDK's
    own auth wiring broke, not a normal caller error."""
    token = get_access_token()
    if token is None or token.subject is None:
        raise ToolError("Not authenticated")
    return uuid.UUID(token.subject)

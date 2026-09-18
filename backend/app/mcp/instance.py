from urllib.parse import urlparse

from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer

from app.core.config import get_settings
from app.mcp.verifier import NookTokenVerifier

settings = get_settings()

server = MCPServer(
    name="nook",
    title=settings.app_name,
    instructions=(
        f"Manage the current user's notes and tasks in {settings.app_name}, a personal "
        "notes-and-tasks app. Notes support Markdown with [[wikilinks]] and #tags. All "
        "reads and writes are scoped to the token owner only."
    ),
    token_verifier=NookTokenVerifier(),
    # `resource_server_url=None` skips RFC 8707 resource-indicator validation (irrelevant
    # here: our tokens are opaque personal access tokens minted by this same app, not
    # issued by a separate authorization server for a specific audience).
    auth=AuthSettings(issuer_url=settings.public_url, resource_server_url=None),
)


def _allowed_hosts() -> list[str]:
    host = urlparse(settings.public_url).netloc
    # Also allow the bare hostname (no port) — a reverse proxy on 80/443 often forwards
    # the Host header without the port even when public_url's origin includes one.
    bare_host = host.split(":")[0]
    return [host, bare_host] if host != bare_host else [host]


allowed_hosts = _allowed_hosts()

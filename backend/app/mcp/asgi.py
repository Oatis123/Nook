from mcp.server.transport_security import TransportSecuritySettings
from starlette.applications import Starlette

from app.mcp import tools  # noqa: F401  (registers every @server.tool())
from app.mcp.instance import allowed_hosts, server

app: Starlette = server.streamable_http_app(
    transport_security=TransportSecuritySettings(
        allowed_hosts=allowed_hosts,
        # Origin is only sent by browser-based clients; a native MCP client (Claude
        # Desktop/Code) never sets it, and a missing Origin already passes this check.
        allowed_origins=[],
    )
)

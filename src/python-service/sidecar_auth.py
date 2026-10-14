"""
Per-launch authentication for the local Limuria Python sidecar.

The Node server (server/pythonService.ts) generates a random token for every
launch and passes it to this process in the LIOS_SIDECAR_TOKEN environment
variable. Every HTTP request must carry it in the X-LiOS-Sidecar-Token header;
otherwise the middleware answers 401. The only unauthenticated route is
GET /health, which returns a minimal liveness payload.

Fail closed: if LIOS_SIDECAR_TOKEN is unset (or empty) the sidecar refuses to
load. The single escape hatch is LIOS_SIDECAR_ALLOW_UNAUTHENTICATED_DEV=1, which
disables authentication entirely. It exists for local debugging only; the
shipped Node launcher never sets it and tests should provide a token instead.
"""

import hmac
import json
import os

TOKEN_ENV = "LIOS_SIDECAR_TOKEN"
ALLOW_UNAUTHENTICATED_DEV_ENV = "LIOS_SIDECAR_ALLOW_UNAUTHENTICATED_DEV"
TOKEN_HEADER = "x-lios-sidecar-token"
HEALTH_PATH = "/health"


class SidecarTokenMissing(RuntimeError):
    """Raised at import/startup when no per-launch token was provided."""


def load_token() -> "str | None":
    """Return the configured token, or None only when the explicit dev override is set."""
    token = os.environ.get(TOKEN_ENV, "").strip()
    if token:
        return token
    if os.environ.get(ALLOW_UNAUTHENTICATED_DEV_ENV, "").strip() == "1":
        return None
    raise SidecarTokenMissing(
        f"{TOKEN_ENV} is not set; refusing to serve the Limuria Python sidecar without a per-launch "
        f"authentication token (set {ALLOW_UNAUTHENTICATED_DEV_ENV}=1 only for explicit local debugging)."
    )


class SidecarTokenMiddleware:
    """Pure ASGI middleware so every route (including docs/openapi) is covered."""

    def __init__(self, app, token: "str | None"):
        self.app = app
        self._token = token.encode("utf-8") if token is not None else None

    def _authorized(self, scope) -> bool:
        if self._token is None:
            return True
        for name, value in scope.get("headers") or []:
            if name == TOKEN_HEADER.encode("latin-1"):
                return hmac.compare_digest(value, self._token)
        return False

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind not in ("http", "websocket"):
            await self.app(scope, receive, send)
            return
        if kind == "http" and scope.get("method") == "GET" and scope.get("path") == HEALTH_PATH:
            await self.app(scope, receive, send)
            return
        if self._authorized(scope):
            await self.app(scope, receive, send)
            return
        if kind == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"detail": "Unauthorized"}).encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode("ascii")),
                (b"www-authenticate", b"X-LiOS-Sidecar-Token"),
            ],
        })
        await send({"type": "http.response.body", "body": body})

import type { IncomingMessage } from "node:http";

/**
 * Browser WebSocket handshakes carry an Origin header that a page cannot forge. Accept the handshake only
 * when that origin is this very server over the scheme the browser actually used, so a page on another
 * site cannot ride the user's session cookie into the live-quote socket. A handshake with no Origin
 * (a non-browser client) is left to the normal session authentication.
 *
 * The scheme is TLS on this socket, or what a trusted proxy reports in X-Forwarded-Proto. It is NOT derived
 * from NODE_ENV: the packaged desktop runs in production over plain loopback HTTP.
 */
export function isAllowedWebSocketOrigin(req: Pick<IncomingMessage, "headers" | "socket">): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const scheme = forwardedProto || ((req.socket as { encrypted?: boolean }).encrypted ? "https" : "http");
    return originUrl.protocol === `${scheme}:` && originUrl.host === req.headers.host;
  } catch {
    return false;
  }
}

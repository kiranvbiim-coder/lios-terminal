"use strict";
/**
 * Only the desktop's own top-level window may receive the per-launch token on requests to its loopback
 * server. A compromised/secondary webContents or cross-origin iframe must not inherit it merely because
 * it shares Electron's defaultSession. Used by main.cjs's onBeforeSendHeaders hook (GM-03 / Q5).
 */
function mayAttachLocalToken(details, { webContentsId, port }) {
  if (details.webContentsId !== webContentsId) return false;
  let target;
  try { target = new URL(details.url); } catch { return false; }
  if (target.protocol !== "http:" && target.protocol !== "ws:") return false;
  if (!(["localhost", "127.0.0.1"].includes(target.hostname)) || target.port !== String(port)) return false;
  if (!details.initiator) return true; // top-level navigation (no source page yet)
  try {
    const initiator = new URL(details.initiator);
    return initiator.protocol === "http:" && initiator.hostname === "localhost" && initiator.port === String(port);
  } catch { return false; }
}
module.exports = { mayAttachLocalToken };

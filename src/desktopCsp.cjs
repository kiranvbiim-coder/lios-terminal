"use strict";

const BASE = "'self' data: blob:";
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/** img-src value derived from the same egress policy the server child enforces (LIOS_EGRESS_MODE / LIOS_EGRESS_ALLOW). */
function imgSrcDirective(env = process.env) {
  const mode = (env.LIOS_EGRESS_MODE || "open").trim().toLowerCase();
  if (mode === "offline") return BASE;
  if (mode !== "allowlist") return `${BASE} https:`;
  const sources = [];
  for (const raw of String(env.LIOS_EGRESS_ALLOW || "").split(",")) {
    const entry = raw.trim().toLowerCase();
    if (!entry || entry.includes("/") || entry.includes(":")) continue; // CIDR and IPv6 are not host rules
    const suffix = entry.startsWith("*.");
    const host = suffix ? entry.slice(2) : entry;
    if (!HOST_RE.test(host) || /^\d+(\.\d+){3}$/.test(host)) continue; // malformed or IPv4 literal
    sources.push(suffix ? `https://*.${host}` : `https://${host}`);
  }
  return [BASE, ...new Set(sources)].join(" ");
}

module.exports = { imgSrcDirective };

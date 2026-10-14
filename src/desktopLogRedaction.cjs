"use strict";

const SECRET_ASSIGNMENT = /((?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|credential|private[-_ ]?key)\s*["']?\s*[:=]\s*["']?)([^\s"',;}&]+)/gi;
const BEARER = /\bbearer\s+[a-z0-9._~+/=-]{8,}/gi;
const OPENAI_STYLE = /\bsk-[a-z0-9_-]{8,}/gi;
const SECRET_QUERY = /([?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|key)=)([^&#\s]+)/gi;

function redactDesktopLogText(value) {
  return String(value ?? "")
    .replace(BEARER, "Bearer [REDACTED]")
    .replace(OPENAI_STYLE, "sk-[REDACTED]")
    .replace(SECRET_ASSIGNMENT, "$1[REDACTED]")
    .replace(SECRET_QUERY, "$1[REDACTED]");
}

module.exports = { redactDesktopLogText };

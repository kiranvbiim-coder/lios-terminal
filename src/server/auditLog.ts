/**
 * Audit Trail Log
 * Appends JSON-line entries to ./data/audit.log with timestamp.
 *
 * Audit logs are operational records, not a second data store. Secrets,
 * credentials and authentication material must never be copied into them.
 */

import fs from "fs";
import path from "path";
import { stateDir } from "./dataRoot";

function auditFile(): string {
  return path.join(stateDir(), "audit.log");
}

function ensureDataDir(): void {
  if (!fs.existsSync(stateDir())) {
    fs.mkdirSync(stateDir(), { recursive: true });
  }
}

const SECRET_FIELD = /(password|passwd|secret|token|api[-_]?key|authorization|cookie|session|private[-_]?key|access[-_]?key)/i;

function redact(value: unknown, fieldName?: string): unknown {
  if (fieldName && SECRET_FIELD.test(fieldName)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redact(child, key);
    }
    return output;
  }
  return value;
}

/**
 * Appends a single JSON-line audit record to data/audit.log.
 * Each line is: { ts, event, ...details }
 * Secret-like fields are redacted before persistence.
 */
export function auditLog(event: string, details?: Record<string, unknown>): void {
  ensureDataDir();
  const record = redact({
    ts: new Date().toISOString(),
    event,
    ...(details ?? {}),
  }) as Record<string, unknown>;
  try {
    fs.appendFileSync(auditFile(), JSON.stringify(record) + "\n", "utf8");
    try { fs.chmodSync(auditFile(), 0o600); } catch { /* Windows may not support chmod semantics */ }
  } catch (err) {
    // Audit failures must never crash the app
    console.warn("[auditLog] write failed:", err);
  }
}
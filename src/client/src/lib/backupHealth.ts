export interface BackupStatusFacts {
  lastError: string | null;
  lastSuccessAt: string | null;
}

export type BackupHealth = "failed" | "never" | "ok" | "stale";

/** failed = the last attempt errored; never = no success yet; stale = last success older than twice the schedule interval. */
export function describeBackupHealth(status: BackupStatusFacts, intervalHours: number, now: number = Date.now()): BackupHealth {
  if (status.lastError) return "failed";
  // Invalid schedule/clock values must not turn unknown backup evidence into OK.
  // Zero is the intentional "automatic backup disabled" interval.
  if (!Number.isFinite(now) || !Number.isFinite(intervalHours) || intervalHours < 0) return "failed";
  if (!status.lastSuccessAt) return "never";
  const last = Date.parse(status.lastSuccessAt);
  if (!Number.isFinite(last)) return "never";
  // Allow minor clock skew, but a future success beyond five minutes cannot
  // establish a trustworthy backup age. Classify as stale until reconciled.
  if (last > now + 5 * 60_000) return "stale";
  return intervalHours > 0 && now - last > 2 * intervalHours * 3_600_000 ? "stale" : "ok";
}

/** Electron prefixes rejected IPC calls with "Error invoking remote method '...': Error: ". */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

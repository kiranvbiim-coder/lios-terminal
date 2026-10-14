/**
 * Client-facing audit trail (Wave 5): one place that writes to
 * clientAuditEvents, so every call site logs the same shape. Deliberately
 * fire-and-forget from the caller's perspective -- an audit-log write
 * failing should never break the action it's recording (a failed watchlist
 * add is a real error the user needs to see; a failed audit-log row for a
 * successful watchlist add is not), so this never throws.
 */
import { getDb } from "./db";
import { clientAuditEvents, type ClientAuditEvent } from "@shared/schema";

export async function logClientAuditEvent(params: {
  organizationId: number;
  userId: number | null;
  eventType: ClientAuditEvent["eventType"];
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    const db = getDb();
    await db.insert(clientAuditEvents).values({
      organizationId: params.organizationId,
      userId: params.userId,
      eventType: params.eventType,
      details: params.details ?? null,
    });
  } catch (err) {
    console.error("Failed to write client audit event:", params.eventType, err);
  }
}

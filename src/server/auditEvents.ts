/**
 * Durable, queryable audit trail for compliance-sensitive actions (org/user
 * management, content publish/approve/suppress). Distinct from the
 * lightweight file-based auditLog.ts, which is fine for high-volume/low-
 * stakes events (API key access, chat messages) but isn't attributable to a
 * specific user or easily queryable -- real compliance recordkeeping needs
 * both of those, so those events go to the database instead.
 */
import { getDb } from "./db";
import { auditEvents, type User } from "@shared/schema";
import { desc, eq } from "drizzle-orm";

export async function recordAuditEvent(
  userId: number | null,
  eventType: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await writeAuditEvent(userId, eventType, details);
  } catch (err) {
    // Audit failures must never block the action that triggered them
    console.warn("[auditEvents] write failed:", err);
  }
}

/**
 * Record an audit event for a security-sensitive mutation.
 *
 * Unlike recordAuditEvent, this deliberately propagates persistence failures.
 * Callers must await it before reporting success, so a failed security audit
 * cannot be silently presented as a durable compliance record.
 */
export async function recordSecurityAuditEvent(
  userId: number | null,
  eventType: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await writeAuditEvent(userId, eventType, details);
}

async function writeAuditEvent(
  userId: number | null,
  eventType: string,
  details?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(auditEvents).values({ userId, eventType, details: details ?? {} });
}

export async function listAuditEvents(limit = 200): Promise<Array<typeof auditEvents.$inferSelect>> {
  const db = getDb();
  return db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(limit);
}

export async function listAuditEventsForUser(userId: number, limit = 200): Promise<Array<typeof auditEvents.$inferSelect>> {
  const db = getDb();
  return db.select().from(auditEvents).where(eq(auditEvents.userId, userId)).orderBy(desc(auditEvents.createdAt)).limit(limit);
}

export function auditActor(user: Pick<User, "id" | "email">) {
  return { userId: user.id, actorEmail: user.email };
}

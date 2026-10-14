import { and, eq, isNull } from "drizzle-orm";
import { projectSessions } from "@shared/schema";
import { projectWorkspaceSessionStateSchema } from "@shared/projectContracts";
import type { TenantContext } from "./tenantContext";
import { getDb } from "./db";
import {
  appendLedgerEventInTransaction,
  findLedgerRevert,
  getLedgerEvent,
  hashLedgerValue,
} from "./ledgerStore";

function tenantSessionFilter(ctx: TenantContext, sessionId: string) {
  return and(
    eq(projectSessions.id, sessionId),
    eq(projectSessions.ownerUserId, ctx.userId),
    ctx.organizationId === null
      ? isNull(projectSessions.organizationId)
      : eq(projectSessions.organizationId, ctx.organizationId),
  );
}

export async function undoLedgerEvent(ctx: TenantContext, eventId: string) {
  const original = await getLedgerEvent(ctx, eventId);
  if (!original.reversible || !original.inversePayload) throw new Error("This Ledger event is not reversible.");
  if (await findLedgerRevert(ctx, eventId)) throw new Error("This Ledger event has already been undone.");

  const inverse = original.inversePayload as Record<string, unknown>;
  const operation = String(inverse.operation || "");
  const sessionId = String(inverse.sessionId || original.sessionId || "");
  if (!sessionId) throw new Error("Undo payload does not identify a Session.");

  const db: any = getDb();
  return db.transaction(async (tx: any) => {
    const [current] = await tx.select().from(projectSessions).where(tenantSessionFilter(ctx, sessionId)).limit(1);
    if (!current) throw new Error("Session for undo was not found or is not owned by the requesting user.");

    if (operation === "restore_project_session_snapshot") {
      const workspaceState = projectWorkspaceSessionStateSchema.parse(inverse.workspaceState);
      const status = inverse.status === "archived" ? "archived" : "active";
      const archivedAt = typeof inverse.archivedAt === "string" ? new Date(inverse.archivedAt) : null;
      await tx.update(projectSessions).set({
        name: typeof inverse.name === "string" ? inverse.name : current.name,
        workspaceState: workspaceState as Record<string, unknown>,
        status,
        archivedAt: status === "archived" ? archivedAt ?? new Date() : null,
        updatedAt: new Date(),
      }).where(tenantSessionFilter(ctx, sessionId));
    } else if (operation === "archive_project_session") {
      const now = new Date();
      await tx.update(projectSessions).set({ status: "archived", archivedAt: now, updatedAt: now }).where(tenantSessionFilter(ctx, sessionId));
    } else if (operation === "restore_project_session") {
      await tx.update(projectSessions).set({ status: "active", archivedAt: null, updatedAt: new Date() }).where(tenantSessionFilter(ctx, sessionId));
    } else {
      throw new Error(`Unsupported reversible Ledger operation: ${operation || "unknown"}.`);
    }

    const [restored] = await tx.select().from(projectSessions).where(tenantSessionFilter(ctx, sessionId)).limit(1);
    return appendLedgerEventInTransaction(tx, ctx, {
      projectId: original.projectId,
      chatId: original.chatId,
      sessionId,
      eventType: "state.reverted",
      actorType: "user",
      causationId: original.id,
      correlationId: original.correlationId ?? original.id,
      payload: {
        originalEventId: original.id,
        originalEventType: original.eventType,
        inverseOperation: operation,
        restoredStateHash: hashLedgerValue(restored?.workspaceState ?? {}),
      },
      lineage: {
        nodes: [
          { kind: "session", ref: sessionId, version: null, hash: hashLedgerValue(restored?.workspaceState ?? {}), asOf: null, metadata: {} },
          { kind: "execution", ref: original.id, version: "ledger-event", hash: original.eventHash, asOf: original.createdAt.toISOString(), metadata: {} },
        ],
        edges: [{ from: original.id, to: sessionId, relation: "changed" }],
      },
    });
  });
}

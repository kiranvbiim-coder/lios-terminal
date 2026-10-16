import { and, eq } from "drizzle-orm";
import { pairedDevices, users, type ProjectChatMessage, type User } from "@shared/schema";
import { DEVICE_REVIEW_POLICY_VERSION, DEVICE_REVIEW_TTL_MS, type DeviceReviewBinding } from "@shared/deviceOutbox";
import { gatewayError, type GatewayScope } from "@shared/gatewayProtocol";
import { getDb, type DrizzleDb } from "./db";
import { GatewayMethodError, type GatewayConnection, type GatewayHub } from "./gatewayHub";
import { deviceNetwork } from "./deviceRuntime";
import { tenantContext } from "./tenantContext";
import { getProject, listProjects } from "./projectStore";
import { createProjectChat, getProjectChat, listProjectChats, listProjectChatMessages } from "./projectChatStore";
import { getArtifact, getArtifactVersion, listProjectArtifacts } from "./artifactStore";
import { listP9Notifications, markP9NotificationRead } from "./p9AutomationStore";
import { DecisionReviewError, decisionReviewHead, readCanonicalDecisionReview, submitCanonicalDecisionReview } from "./decisionRoutes";
import { decisionSnapshotHash } from "./decisionEngine";

/** Every paired call uses current Home identity; handshake claims are never a lasting permission grant. */
export async function requireCurrentGatewayUser(connection: GatewayConnection, scope: GatewayScope = "read", db: DrizzleDb = getDb()): Promise<User> {
  const [user] = await db.select().from(users).where(eq(users.id, connection.identity.userId)).for("share").limit(1);
  if (!user || !user.active || user.mustChangePassword || (user.lockedUntil && user.lockedUntil.getTime() > Date.now())) throw new GatewayMethodError(gatewayError("FORBIDDEN", "The current account cannot use device continuity."));
  if (user.role !== connection.identity.role || (user.organizationId ?? null) !== connection.identity.organizationId) throw new GatewayMethodError(gatewayError("FORBIDDEN", "Account identity changed; reconnect and inspect current permissions."));
  if (!connection.scopes.includes(scope) && !(scope === "read" && connection.scopes.includes("write")) && !connection.scopes.includes("admin")) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This connection lacks the current required scope."));
  if (connection.identity.deviceId) {
    const [device] = await db.select().from(pairedDevices).where(and(eq(pairedDevices.id, connection.identity.deviceId), eq(pairedDevices.ownerUserId, user.id))).for("share").limit(1);
    if (!device || device.revokedAt || (device.organizationId ?? null) !== (user.organizationId ?? null) || (!device.scopes.includes(scope) && !(scope === "read" && device.scopes.includes("write")))) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This device is revoked or its current scopes no longer permit this request."));
  }
  return user;
}

async function currentReviewPolicy(connection: GatewayConnection, db: DrizzleDb, scope: GatewayScope) {
  const user = await requireCurrentGatewayUser(connection, scope, db);
  const [device] = connection.identity.deviceId ? await db.select().from(pairedDevices).where(eq(pairedDevices.id, connection.identity.deviceId)).limit(1) : [];
  return { user, digest: decisionSnapshotHash({ version: DEVICE_REVIEW_POLICY_VERSION, userId: user.id, role: user.role, organizationId: user.organizationId ?? null, active: user.active, mustChangePassword: user.mustChangePassword, deviceId: device?.id ?? null, scopes: device?.scopes ?? connection.scopes, pairedAt: device?.createdAt ?? null }) };
}

function publicRecord(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

export function registerDeviceContinuityGateway(hub: GatewayHub, options: { homeId?: () => string | null } = {}): void {
  const homeId = options.homeId ?? (() => deviceNetwork.status().homeId);
  const currentHome = () => {
    const id = homeId();
    if (!id) throw new GatewayMethodError(gatewayError("UNAVAILABLE", "Enable this Home's paired-device listener before reading or releasing device reviews."));
    return id;
  };
  const guarded = async <T>(connection: GatewayConnection, scope: GatewayScope, operation: (user: User) => Promise<T>): Promise<T> => {
    try { return await operation(await requireCurrentGatewayUser(connection, scope)); }
    catch (error) {
      if (error instanceof DecisionReviewError) throw new GatewayMethodError(gatewayError(error.statusCode === 403 ? "FORBIDDEN" : error.statusCode === 404 ? "NOT_FOUND" : "INVALID_REQUEST", error.message, { details: { statusCode: error.statusCode, ...error.details } }));
      if (error instanceof GatewayMethodError) throw error;
      if (error instanceof Error && /access denied|not found|not belong|ownership|boundary/i.test(error.message)) throw new GatewayMethodError(gatewayError("FORBIDDEN", "The current account cannot access this canonical resource."));
      throw error;
    }
  };
  hub.register("projects.list", (_params, connection) => guarded(connection, "read", async (user) => ({ projects: (await listProjects(tenantContext(user))).map(publicRecord) })));
  hub.register("chats.create", (params, connection) => guarded(connection, "write", async (user) => ({ chat: publicRecord(await createProjectChat(tenantContext(user), { projectId: params.projectId, scope: "project", title: params.title })) })));
  hub.register("device.continuity.read", (params, connection) => guarded(connection, "read", async (user) => {
    const ctx = tenantContext(user);
    const project = await getProject(ctx, params.projectId);
    const [chats, artifacts] = await Promise.all([listProjectChats(ctx, { projectId: project.id }), listProjectArtifacts(ctx, project.id, { limit: 100 })]);
    let messages: ProjectChatMessage[] = [];
    if (params.chatId) {
      const chat = await getProjectChat(ctx, params.chatId);
      if (chat.projectId !== project.id) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This Chat does not belong to the requested Project."));
      messages = await listProjectChatMessages(ctx, chat.id);
    }
    return { homeId: currentHome(), userId: user.id, project: publicRecord(project), chats: chats.map(publicRecord), messages: messages.slice(params.offset, params.offset + params.limit).map(publicRecord), artifacts: artifacts.map(publicRecord), nextOffset: messages.length > params.offset + params.limit ? params.offset + params.limit : null };
  }));
  hub.register("artifacts.read", (params, connection) => guarded(connection, "read", async (user) => {
    const ctx = tenantContext(user);
    const artifact = await getArtifact(ctx, params.artifactId);
    const revision = await getArtifactVersion(ctx, artifact.id, params.version);
    // Existing Gateway frame limits fail closed for oversized revisions; never return partial success.
    return { artifact: publicRecord(artifact), revision: publicRecord(revision) };
  }));
  hub.register("notifications.list", (params, connection) => guarded(connection, "read", async (user) => ({ notifications: (await listP9Notifications(tenantContext(user), params.projectId, params.limit)).map(publicRecord) })));
  hub.register("notifications.read", (params, connection) => guarded(connection, "write", async (user) => ({ notification: publicRecord(await markP9NotificationRead(tenantContext(user), params.projectId, params.notificationId)) })));
  hub.register("decision.review.read", (params, connection) => guarded(connection, "read", async () => {
    const policy = await currentReviewPolicy(connection, getDb(), "read");
    const state = await readCanonicalDecisionReview(params.decisionId, policy.user);
    const issued = Date.now();
    const binding: DeviceReviewBinding = { homeId: currentHome(), userId: policy.user.id, deviceId: connection.identity.deviceId ?? null, decisionId: state.decision.id, receiptVersionId: state.receipt.id, snapshotHash: state.receipt.snapshotHash, decisionHead: decisionReviewHead(state.decision), policyDigest: policy.digest, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + DEVICE_REVIEW_TTL_MS).toISOString() };
    return { binding, decision: publicRecord(state.decision), receipt: publicRecord(state.receipt), approval: state.approval ? publicRecord(state.approval) : null, canReview: state.canReview && (connection.scopes.includes("write") || connection.scopes.includes("admin")) };
  }));
  hub.register("decision.review.submit", (params, connection) => guarded(connection, "write", async (user) => {
    if (params.binding.homeId !== currentHome() || params.binding.deviceId !== (connection.identity.deviceId ?? null) || params.binding.userId !== user.id) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This review draft belongs to another Home, account or paired device."));
    const result = await submitCanonicalDecisionReview(params.binding.decisionId, user, { receiptVersionId: params.binding.receiptVersionId, requestId: params.requestId, outcome: params.outcome, finalDecision: params.finalDecision, rationale: params.rationale, note: params.note }, {
      binding: params.binding,
      revalidate: async (db) => {
        if (params.binding.homeId !== currentHome()) throw new GatewayMethodError(gatewayError("FORBIDDEN", "This Home identity changed before review release."));
        return (await currentReviewPolicy(connection, db, "write")).digest;
      },
    });
    return { approvalId: result.approval.id, decisionId: result.approval.decisionId, receiptVersionId: result.approval.receiptVersionId, snapshotHash: result.approval.snapshotHash, outcome: result.approval.outcome, requestId: params.requestId, idempotent: result.idempotent };
  }));
}

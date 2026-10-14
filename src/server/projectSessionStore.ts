import crypto from "node:crypto";
import { and, desc, eq, isNull, isNotNull } from "drizzle-orm";
import { getDb } from "./db";
import { projectSessions, type ProjectSession } from "@shared/schema";
import {
  createProjectSessionSchema,
  projectWorkspaceSessionStateSchema,
  updateProjectSessionSchema,
  type ProjectWorkspaceSessionState,
} from "@shared/projectContracts";
import type { SessionDifference, SessionChangeExplanation } from "@shared/ledgerContracts";
import type { TenantContext } from "./tenantContext";
import { getProject, touchProjectActivity } from "./projectStore";
import { getProjectChat } from "./projectChatStore";
import {
  appendLedgerEventInTransaction,
  hashLedgerValue,
  sanitizeLedgerPayload,
} from "./ledgerStore";

export class ProjectSessionAccessDeniedError extends Error {
  constructor() {
    super("Session not found or not owned by the requesting user.");
    this.name = "ProjectSessionAccessDeniedError";
  }
}

function tenantFilter(ctx: TenantContext) {
  return ctx.organizationId === null
    ? and(eq(projectSessions.ownerUserId, ctx.userId), isNull(projectSessions.organizationId))
    : and(eq(projectSessions.ownerUserId, ctx.userId), eq(projectSessions.organizationId, ctx.organizationId));
}

export async function getProjectSessionIncludingTrash(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const [row] = await getDb().select().from(projectSessions)
    .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx)))
    .limit(1);
  if (!row) throw new ProjectSessionAccessDeniedError();
  projectWorkspaceSessionStateSchema.parse(row.workspaceState);
  return row;
}

export async function getProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const row = await getProjectSessionIncludingTrash(ctx, sessionId);
  if (row.trashedAt) throw new ProjectSessionAccessDeniedError();
  return row;
}

export async function listProjectSessions(
  ctx: TenantContext,
  projectId: number,
  status: "active" | "archived" = "active",
  trash = false,
): Promise<ProjectSession[]> {
  await getProject(ctx, projectId);
  const rows = await getDb().select().from(projectSessions)
    .where(and(
      tenantFilter(ctx),
      eq(projectSessions.projectId, projectId),
      eq(projectSessions.status, status),
      trash ? isNotNull(projectSessions.trashedAt) : isNull(projectSessions.trashedAt),
    ))
    .orderBy(desc(projectSessions.updatedAt));
  for (const row of rows) projectWorkspaceSessionStateSchema.parse(row.workspaceState);
  return rows;
}

async function validateSessionLinks(
  ctx: TenantContext,
  input: { projectId: number; chatId?: number | null; parentSessionId?: string | null },
): Promise<void> {
  await getProject(ctx, input.projectId);
  if (input.chatId) {
    const chat = await getProjectChat(ctx, input.chatId);
    if (chat.projectId !== input.projectId) throw new Error("Session chat must belong to the same Project.");
  }
  if (input.parentSessionId) {
    const parent = await getProjectSession(ctx, input.parentSessionId);
    if (parent.projectId !== input.projectId) throw new Error("Session parent must belong to the same Project.");
  }
}

function sessionSnapshotInverse(session: ProjectSession) {
  return {
    operation: "restore_project_session_snapshot",
    sessionId: session.id,
    name: session.name,
    workspaceState: sanitizeLedgerPayload(session.workspaceState) as Record<string, unknown>,
    status: session.status,
    archivedAt: session.archivedAt?.toISOString() ?? null,
  };
}

function stateProvenance(state: ProjectWorkspaceSessionState) {
  return state.provenance ?? {
    layoutStateRef: null,
    sourcePolicyRef: null,
    strategyRef: null,
    backtestRef: null,
    assumptionRefs: [],
    artifactVersionRefs: [],
  };
}

function diffValue(
  category: SessionDifference["category"],
  left: unknown,
  right: unknown,
  changedSummary: string,
  sameSummary: string,
): SessionDifference {
  const leftHash = hashLedgerValue(sanitizeLedgerPayload(left));
  const rightHash = hashLedgerValue(sanitizeLedgerPayload(right));
  const changed = leftHash !== rightHash;
  return {
    category,
    changed,
    summary: changed ? changedSummary : sameSummary,
    leftHash,
    rightHash,
  };
}

export function compareProjectSessionStateValues(input: {
  left: ProjectSession;
  right: ProjectSession;
}): SessionDifference[] {
  const leftState = projectWorkspaceSessionStateSchema.parse(input.left.workspaceState);
  const rightState = projectWorkspaceSessionStateSchema.parse(input.right.workspaceState);
  const leftProv = stateProvenance(leftState);
  const rightProv = stateProvenance(rightState);
  return [
    diffValue("ancestry", input.left.parentSessionId, input.right.parentSessionId, "Branch ancestry differs.", "Branch ancestry is the same."),
    diffValue("session_name", input.left.name, input.right.name, "Session names differ.", "Session names are the same."),
    diffValue("layout", {
      engine: leftState.workspaceEngine,
      layout: leftState.dockviewLayout,
      ref: leftProv.layoutStateRef,
    }, {
      engine: rightState.workspaceEngine,
      layout: rightState.dockviewLayout,
      ref: rightProv.layoutStateRef,
    }, "Workspace layout or layout reference changed.", "Workspace layout is unchanged."),
    diffValue("analytical_state", leftState.analyticalState, rightState.analyticalState, "Analytical state changed.", "Analytical state is unchanged."),
    diffValue("linked_context", leftState.linkedContext, rightState.linkedContext, "Linked instrument/time/scenario context changed.", "Linked context is unchanged."),
    diffValue("focused_object", leftState.focusedObject, rightState.focusedObject, "Focused object changed.", "Focused object is unchanged."),
    diffValue("saved_view", leftState.savedViewName, rightState.savedViewName, "Saved view changed.", "Saved view is unchanged."),
    diffValue("source_policy", leftProv.sourcePolicyRef, rightProv.sourcePolicyRef, "Source policy changed.", "Source policy is unchanged."),
    diffValue("strategy", leftProv.strategyRef, rightProv.strategyRef, "Strategy configuration changed.", "Strategy configuration is unchanged."),
    diffValue("backtest", leftProv.backtestRef, rightProv.backtestRef, "Backtest configuration changed.", "Backtest configuration is unchanged."),
    diffValue("assumptions", leftProv.assumptionRefs, rightProv.assumptionRefs, "Assumption references changed.", "Assumption references are unchanged."),
    diffValue("artifact_versions", leftProv.artifactVersionRefs, rightProv.artifactVersionRefs, "Referenced artifact versions changed.", "Artifact version references are unchanged."),
  ];
}

function deterministicExplanation(differences: SessionDifference[]): string[] {
  const changed = differences.filter((item) => item.changed);
  if (!changed.length) return ["No material Session-state differences were detected."];
  return changed.map((item) => {
    switch (item.category) {
      case "ancestry": return "The Sessions descend from different parent state, so downstream results may diverge even before new calculations run.";
      case "session_name": return "The Session label changed; this is descriptive and does not by itself alter calculations.";
      case "layout": return "The analytical workspace layout/configuration reference changed.";
      case "analytical_state": return "One or more persisted analytical inputs or panel states changed.";
      case "linked_context": return "The linked instrument, date, scenario, portfolio or benchmark context changed.";
      case "focused_object": return "The active analytical object changed between Sessions.";
      case "saved_view": return "The saved workspace view changed.";
      case "source_policy": return "The governed source-policy reference changed, so provider selection or allowed data may differ.";
      case "strategy": return "The strategy configuration reference changed.";
      case "backtest": return "The backtest configuration reference changed.";
      case "assumptions": return "The set of assumption references changed.";
      case "artifact_versions": return "The Sessions reference different artifact versions.";
    }
  });
}

export async function createProjectSession(
  ctx: TenantContext,
  input: {
    projectId: number;
    chatId?: number | null;
    parentSessionId?: string | null;
    name: string;
    workspaceState: ProjectWorkspaceSessionState;
  },
): Promise<ProjectSession> {
  const parsed = createProjectSessionSchema.parse(input);
  await validateSessionLinks(ctx, parsed);
  const db: any = getDb();
  const row = await db.transaction(async (tx: any) => {
    const id = `session:${crypto.randomUUID()}`;
    const [created] = await tx.insert(projectSessions).values({
      id,
      projectId: parsed.projectId,
      chatId: parsed.chatId ?? null,
      parentSessionId: parsed.parentSessionId ?? null,
      ownerUserId: ctx.userId,
      organizationId: ctx.organizationId,
      name: parsed.name,
      workspaceState: parsed.workspaceState as Record<string, unknown>,
    }).returning();
    const eventType = parsed.parentSessionId ? "session.forked" : "session.created";
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: parsed.projectId,
      chatId: parsed.chatId ?? null,
      sessionId: id,
      eventType,
      actorType: "user",
      payload: {
        sessionId: id,
        name: parsed.name,
        parentSessionId: parsed.parentSessionId ?? null,
        workspaceStateHash: hashLedgerValue(parsed.workspaceState),
        provenance: sanitizeLedgerPayload(stateProvenance(parsed.workspaceState)),
      },
      lineage: {
        nodes: [
          { kind: "session", ref: id, version: "1", hash: hashLedgerValue(parsed.workspaceState), asOf: null, metadata: { name: parsed.name } },
          ...(parsed.parentSessionId ? [{ kind: "session" as const, ref: parsed.parentSessionId, version: null, hash: null, asOf: null, metadata: {} }] : []),
          ...(parsed.chatId ? [{ kind: "conversation" as const, ref: `chat:${parsed.chatId}`, version: "1", hash: null, asOf: null, metadata: {} }] : []),
        ],
        edges: [
          ...(parsed.parentSessionId ? [{ from: parsed.parentSessionId, to: id, relation: "forked_from" as const }] : []),
          ...(parsed.chatId ? [{ from: `chat:${parsed.chatId}`, to: id, relation: "configured_by" as const }] : []),
        ],
      },
      reversible: true,
      inversePayload: { operation: "archive_project_session", sessionId: id },
    });
    return created as ProjectSession;
  });
  await touchProjectActivity(ctx, parsed.projectId);
  return row;
}

export async function updateProjectSession(
  ctx: TenantContext,
  sessionId: string,
  patch: { name?: string; workspaceState?: ProjectWorkspaceSessionState },
): Promise<ProjectSession> {
  const current = await getProjectSession(ctx, sessionId);
  const parsed = updateProjectSessionSchema.parse(patch);
  const db: any = getDb();
  const row = await db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectSessions)
      .set({
        ...(parsed.name !== undefined ? { name: parsed.name } : {}),
        ...(parsed.workspaceState !== undefined ? { workspaceState: parsed.workspaceState as Record<string, unknown> } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx)))
      .returning();
    if (!updated) throw new ProjectSessionAccessDeniedError();
    const differences = compareProjectSessionStateValues({ left: current, right: updated as ProjectSession });
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: current.projectId,
      chatId: current.chatId,
      sessionId,
      eventType: "session.updated",
      actorType: "user",
      payload: {
        sessionId,
        nameChanged: current.name !== updated.name,
        differences: differences.filter((item) => item.changed),
        explanation: deterministicExplanation(differences),
        beforeStateHash: hashLedgerValue(current.workspaceState),
        afterStateHash: hashLedgerValue(updated.workspaceState),
      },
      lineage: {
        nodes: [
          { kind: "session", ref: `${sessionId}@before`, version: "before", hash: hashLedgerValue(current.workspaceState), asOf: current.updatedAt.toISOString(), metadata: { sessionId } },
          { kind: "session", ref: `${sessionId}@after`, version: "after", hash: hashLedgerValue(updated.workspaceState), asOf: updated.updatedAt.toISOString(), metadata: { sessionId } },
        ],
        edges: [{ from: `${sessionId}@before`, to: `${sessionId}@after`, relation: "supersedes" }],
      },
      reversible: true,
      inversePayload: sessionSnapshotInverse(current),
    });
    return updated as ProjectSession;
  });
  await touchProjectActivity(ctx, current.projectId);
  return row;
}

export async function forkProjectSession(
  ctx: TenantContext,
  sessionId: string,
  name?: string,
): Promise<ProjectSession> {
  const source = await getProjectSession(ctx, sessionId);
  const state = projectWorkspaceSessionStateSchema.parse(source.workspaceState);
  return createProjectSession(ctx, {
    projectId: source.projectId,
    chatId: source.chatId,
    parentSessionId: source.id,
    name: name?.trim() || `${source.name} — Fork`,
    workspaceState: state,
  });
}
export async function archiveProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const current = await getProjectSession(ctx, sessionId);
  const now = new Date();
  const db: any = getDb();
  const row = await db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectSessions)
      .set({ status: "archived", archivedAt: now, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now })
      .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx)))
      .returning();
    if (!updated) throw new ProjectSessionAccessDeniedError();
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: current.projectId,
      chatId: current.chatId,
      sessionId,
      eventType: "session.archived",
      actorType: "user",
      payload: { sessionId, archivedAt: now.toISOString() },
      reversible: true,
      inversePayload: { operation: "restore_project_session", sessionId },
    });
    return updated as ProjectSession;
  });
  await touchProjectActivity(ctx, current.projectId);
  return row;
}

export async function restoreProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const current = await getProjectSession(ctx, sessionId);
  const now = new Date();
  const db: any = getDb();
  const row = await db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectSessions)
      .set({ status: "active", archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now })
      .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx)))
      .returning();
    if (!updated) throw new ProjectSessionAccessDeniedError();
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: current.projectId,
      chatId: current.chatId,
      sessionId,
      eventType: "session.restored",
      actorType: "user",
      payload: { sessionId, restoredAt: now.toISOString() },
      reversible: true,
      inversePayload: { operation: "archive_project_session", sessionId },
    });
    return updated as ProjectSession;
  });
  await touchProjectActivity(ctx, current.projectId);
  return row;
}

export async function trashProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const current = await getProjectSession(ctx, sessionId);
  const now = new Date();
  const db: any = getDb();
  const row = await db.transaction(async (tx: any) => {
    const [updated] = await tx.update(projectSessions)
      .set({ status: "archived", archivedAt: current.status === "active" ? now : current.archivedAt, trashedAt: now, trashedByProjectId: null, trashedFromStatus: current.status, updatedAt: now })
      .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx)))
      .returning();
    if (!updated) throw new ProjectSessionAccessDeniedError();
    await appendLedgerEventInTransaction(tx, ctx, {
      projectId: current.projectId,
      chatId: current.chatId,
      sessionId,
      eventType: "session.archived",
      actorType: "user",
      payload: { sessionId, trashedAt: now.toISOString() },
      reversible: true,
      inversePayload: { operation: "restore_project_session", sessionId },
    });
    return updated as ProjectSession;
  });
  await touchProjectActivity(ctx, current.projectId);
  return row;
}

export async function restoreTrashedProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession> {
  const current = await getProjectSessionIncludingTrash(ctx, sessionId);
  if (!current.trashedAt) throw new Error("Session is not in Trash.");
  await getProject(ctx, current.projectId);
  const restoredStatus = current.trashedFromStatus === "archived" ? "archived" : "active";
  const now = new Date();
  const [updated] = await getDb().update(projectSessions)
    .set({ status: restoredStatus, ...(restoredStatus === "active" ? { archivedAt: null } : {}), trashedAt: null, trashedByProjectId: null, trashedFromStatus: null, updatedAt: now })
    .where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx), isNotNull(projectSessions.trashedAt)))
    .returning();
  if (!updated) throw new ProjectSessionAccessDeniedError();
  await touchProjectActivity(ctx, current.projectId);
  return updated;
}

export async function permanentlyDeleteProjectSession(ctx: TenantContext, sessionId: string): Promise<void> {
  const current = await getProjectSessionIncludingTrash(ctx, sessionId);
  if (!current.trashedAt) throw new Error("Session must be in Trash before permanent deletion.");
  const deleted = await getDb().delete(projectSessions).where(and(eq(projectSessions.id, sessionId), tenantFilter(ctx), isNotNull(projectSessions.trashedAt))).returning();
  if (!deleted.length) throw new ProjectSessionAccessDeniedError();
}

export interface ProjectSessionComparison {
  leftId: string;
  rightId: string;
  sameProject: boolean;
  sameChat: boolean;
  sameParent: boolean;
  workspaceEngineChanged: boolean;
  analyticalStateChanged: boolean;
  linkedContextChanged: boolean;
  focusedObjectChanged: boolean;
  savedViewChanged: boolean;
  commonAncestorId: string | null;
  differences: SessionDifference[];
  explanation: string[];
}

export async function getProjectSessionAncestry(ctx: TenantContext, sessionId: string): Promise<ProjectSession[]> {
  const ancestry: ProjectSession[] = [];
  const seen = new Set<string>();
  let current: ProjectSession | null = await getProjectSession(ctx, sessionId);
  while (current && ancestry.length < 200) {
    if (seen.has(current.id)) throw new Error("Session ancestry cycle detected.");
    seen.add(current.id);
    ancestry.push(current);
    current = current.parentSessionId ? await getProjectSession(ctx, current.parentSessionId) : null;
  }
  if (current) throw new Error("Session ancestry exceeds the 200-generation safety limit.");
  return ancestry;
}

export async function compareProjectSessions(
  ctx: TenantContext,
  leftId: string,
  rightId: string,
): Promise<ProjectSessionComparison> {
  const [left, right, leftAncestry, rightAncestry] = await Promise.all([
    getProjectSession(ctx, leftId),
    getProjectSession(ctx, rightId),
    getProjectSessionAncestry(ctx, leftId),
    getProjectSessionAncestry(ctx, rightId),
  ]);
  if (left.projectId !== right.projectId) throw new Error("Sessions from different Projects cannot be compared.");
  const leftState = projectWorkspaceSessionStateSchema.parse(left.workspaceState);
  const rightState = projectWorkspaceSessionStateSchema.parse(right.workspaceState);
  const rightIds = new Set(rightAncestry.map((session) => session.id));
  const commonAncestorId = leftAncestry.find((session) => rightIds.has(session.id))?.id ?? null;
  const differences = compareProjectSessionStateValues({ left, right });
  return {
    leftId,
    rightId,
    sameProject: true,
    sameChat: left.chatId === right.chatId,
    sameParent: left.parentSessionId === right.parentSessionId,
    workspaceEngineChanged: leftState.workspaceEngine !== rightState.workspaceEngine,
    analyticalStateChanged: differences.find((item) => item.category === "analytical_state")?.changed ?? false,
    linkedContextChanged: differences.find((item) => item.category === "linked_context")?.changed ?? false,
    focusedObjectChanged: differences.find((item) => item.category === "focused_object")?.changed ?? false,
    savedViewChanged: differences.find((item) => item.category === "saved_view")?.changed ?? false,
    commonAncestorId,
    differences,
    explanation: deterministicExplanation(differences),
  };
}

export async function explainProjectSessionChange(
  ctx: TenantContext,
  leftId: string,
  rightId: string,
): Promise<SessionChangeExplanation> {
  const comparison = await compareProjectSessions(ctx, leftId, rightId);
  return {
    leftSessionId: leftId,
    rightSessionId: rightId,
    commonAncestorId: comparison.commonAncestorId,
    differences: comparison.differences,
    explanation: comparison.explanation,
    comparedAt: new Date().toISOString(),
  };
}

export async function getParentProjectSession(ctx: TenantContext, sessionId: string): Promise<ProjectSession | null> {
  const session = await getProjectSession(ctx, sessionId);
  return session.parentSessionId ? getProjectSession(ctx, session.parentSessionId) : null;
}

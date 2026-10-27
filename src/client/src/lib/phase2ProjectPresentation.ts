import type { ProjectChat, ProjectSession } from "@/lib/useProjects";
import type { P6ProjectContinuitySnapshot } from "@shared/p6ContinuityContracts";
import type { P9NotificationRecord, P9RunRecord, P9WorkflowRecord } from "@/lib/useP9Automation";
import { workflowExecutionTruth, workflowScheduleSummary } from "@/lib/workflowReviewTruth";
import { recordedIsoTimestamp } from "./recordedIsoTimestamp";

/** Read-only Project continuity projection. Never infer ownership from a title or a global ID. */
export function projectResumeSelection(projectId: number, chats: readonly ProjectChat[], sessions: readonly ProjectSession[]) {
  const activeChats = chats.filter(row => row.projectId === projectId && row.scope === "project" && row.status === "active" && !row.trashedAt);
  const activeSessions = sessions.filter(row => row.projectId === projectId && row.status === "active" && !row.trashedAt);
  const newest = <T>(rows: readonly T[], timestamp: (value: T) => string, key: (value: T) => string) =>
    [...rows].sort((a, b) => (Date.parse(timestamp(b)) || 0) - (Date.parse(timestamp(a)) || 0) || key(a).localeCompare(key(b)))[0] ?? null;
  return {
    chat: newest(activeChats, row => row.lastActivityAt, row => String(row.id)),
    session: newest(activeSessions, row => row.updatedAt, row => row.id),
  };
}

/** This is an existing, identity-checked P6 retained snapshot, not a recomputed task plan. */
export function projectResumeItems(projectId: number, snapshot: P6ProjectContinuitySnapshot | undefined) {
  if (!snapshot || snapshot.projectId !== projectId || snapshot.graph.projectId !== projectId || snapshot.dependencies.projectId !== projectId) return [];
  return snapshot.continuationQueue.slice(0, 4);
}

export interface ProjectWatchroomView {
  workflow: P9WorkflowRecord;
  latestRun: P9RunRecord | null;
  state: ReturnType<typeof workflowExecutionTruth>;
  schedule: string;
}

/** All summaries are strictly from currently returned, Project-matching P9 records. */
export function projectWatchroomSummary(
  projectId: number,
  workflows: readonly P9WorkflowRecord[],
  runs: readonly P9RunRecord[],
  notifications: readonly P9NotificationRecord[],
) {
  const owned = workflows.filter(workflow => workflow.projectId === projectId);
  const ownedIds = new Set(owned.map(workflow => workflow.id));
  const ownedRuns = runs.filter(run => run.projectId === projectId && ownedIds.has(run.workflowId) && recordedIsoTimestamp(run.startedAt) !== null);
  const recentRuns = [...ownedRuns].sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
  const latest = new Map<string, P9RunRecord>();
  for (const run of recentRuns) if (!latest.has(run.workflowId)) latest.set(run.workflowId, run);
  const views: ProjectWatchroomView[] = owned.map(workflow => ({
    workflow,
    latestRun: latest.get(workflow.id) ?? null,
    state: workflowExecutionTruth(workflow, latest.get(workflow.id)),
    schedule: workflowScheduleSummary(workflow),
  }));
  const alerts = [...notifications]
    .filter(row => row.projectId === projectId && ownedIds.has(row.workflowId) && row.status === "delivered" && !row.readAt)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));
  return {
    rooms: views,
    enabled: views.filter(room => room.state.state === "enabled").length,
    unread: alerts,
    failed: views.filter(room => room.latestRun?.status === "failed").length,
  };
}

/**
 * Source-recorded Watchroom activity strip. Unlike a synthetic sparkline, each
 * categorical status represents an actual P9 run with an exact Project and
 * workflow owner and a valid recorded timestamp. Never infer a skipped run.
 */
export function watchroomRecordedHistory(
  projectId: number,
  workflowId: string,
  runs: readonly P9RunRecord[],
  limit = 12,
): P9RunRecord[] {
  if (!Number.isInteger(projectId) || projectId < 1 || !workflowId.trim()) return [];
  const max = Number.isFinite(limit) ? Math.max(1, Math.min(24, Math.floor(limit))) : 12;
  return runs.filter(run =>
    run.projectId === projectId && run.workflowId === workflowId &&
    recordedIsoTimestamp(run.startedAt) !== null
  ).sort((left, right) =>
    Date.parse(right.startedAt) - Date.parse(left.startedAt) || left.id.localeCompare(right.id)
  ).slice(0, max).reverse();
}

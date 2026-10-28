import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectChat, ProjectSession } from "@/lib/useProjects";
import type { P6ProjectContinuitySnapshot } from "@shared/p6ContinuityContracts";
import type { P9NotificationRecord, P9RunRecord, P9WorkflowRecord } from "@/lib/useP9Automation";
import { projectResumeItems, projectResumeRecentWork, projectResumeSelection, projectWatchroomSummary, watchroomRecordedHistory } from "./phase2ProjectPresentation";

const chat = (id: number, projectId: number, lastActivityAt: string): ProjectChat => ({
  id, projectId, ownerUserId: 11, organizationId: null, scope: "project", title: "Saved chat " + id, pinned: false,
  status: "active", lastActivityAt, createdAt: lastActivityAt, updatedAt: lastActivityAt,
  archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null,
});
const session = (id: string, projectId: number, updatedAt: string): ProjectSession => ({
  id, projectId, chatId: null, parentSessionId: null, ownerUserId: 11, organizationId: null,
  name: "Session " + id, status: "active", workspaceState: {} as ProjectSession["workspaceState"],
  createdAt: updatedAt, updatedAt, archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null,
});
const workflow = (id: string, projectId: number, enabled = true): P9WorkflowRecord => ({
  id, projectId, ownerUserId: 11, organizationId: null, name: "Watched " + id, description: "",
  template: "custom", enabled, trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
  action: { kind: "project_what_changed" }, notificationPolicy: {
    enabled: true, channels: ["in_app"], notifyOn: ["failure"], minimumRelevanceScore: 0.5, cooldownMinutes: 60, suppressUnchanged: true,
  }, sourceRefs: [], engineRefs: [], artifactRefs: [], eventCursor: {}, nextRunAt: null, lastRunAt: null,
  lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z",
});
const run = (id: string, workflowId: string, projectId: number, status: P9RunRecord["status"], startedAt: string): P9RunRecord => ({
  id, workflowId, projectId, triggerType: "manual", status, startedAt, completedAt: status === "running" ? null : startedAt,
  summary: status, changed: false, conditionMet: false, relevanceScore: 0,
  sourceRefs: ["source:real"], engineRefs: [], artifactRefs: [], executionReceiptIds: ["receipt:real"],
  output: {}, error: status === "failed" ? "Recorded error" : null,
});
const note = (id: string, workflowId: string, projectId: number, readAt: string | null = null): P9NotificationRecord => ({
  id, workflowId, projectId, runId: "run:1", channel: "in_app", status: "delivered", reason: "change_detected",
  title: id, body: "Original notification", relevanceScore: 0.8, readAt, createdAt: "2026-10-27T08:00:00Z",
});

test("Project resume chooses only current active, non-trashed work, never another Project", () => {
  const chats = [
    chat(1, 5, "2026-10-26T00:00:00Z"), chat(2, 6, "2026-10-28T00:00:00Z"),
    chat(3, 5, "2026-10-27T00:00:00Z"),
    { ...chat(4, 5, "2026-10-29T00:00:00Z"), status: "archived" as const },
    { ...chat(5, 5, "2026-10-30T00:00:00Z"), trashedAt: "2026-10-30T00:00:00Z" },
  ];
  const sessions = [session("a", 5, "2026-10-24T00:00:00Z"), session("b", 6, "2026-10-29T00:00:00Z"), session("c", 5, "2026-10-25T00:00:00Z")];
  const selected = projectResumeSelection(5, chats, sessions);
  assert.equal(selected.chat?.id, 3);
  assert.equal(selected.session?.id, "c");
  assert.equal(chats[0].id, 1);
  assert.equal(projectResumeSelection(7, chats, sessions).chat, null);
});

test("A09 multiple Project resume choices stay bounded, sorted, scoped and immutable", () => {
  const chats = [
    chat(1, 4, "2026-10-24T08:00:00Z"), chat(2, 4, "2026-10-26T08:00:00Z"),
    chat(3, 4, "2026-10-27T08:00:00Z"), chat(4, 4, "2026-10-25T08:00:00Z"),
    chat(5, 4, "2026-10-20T08:00:00Z"), chat(6, 7, "2026-10-28T08:00:00Z"),
    { ...chat(7, 4, "2026-10-29T08:00:00Z"), trashedAt: "2026-10-29T08:00:00Z" },
    { ...chat(8, 4, "2026-10-30T08:00:00Z"), status: "archived" as const },
    { ...chat(9, 4, "2026-10-31T08:00:00Z"), scope: "quick" as const },
  ];
  const sessions = [
    session("old", 4, "2026-10-24T08:00:00Z"),
    session("latest", 4, "2026-10-27T08:00:00Z"),
    session("other", 7, "2026-10-30T08:00:00Z"),
    { ...session("trashed", 4, "2026-10-31T08:00:00Z"), trashedAt: "2026-10-31T08:00:00Z" },
  ];
  const result = projectResumeRecentWork(4, chats, sessions, 4);
  assert.deepEqual(result.chats.map(row => row.id), [3, 2, 4, 1]);
  assert.deepEqual(result.sessions.map(row => row.id), ["latest", "old"]);
  assert.deepEqual(chats.map(row => row.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(projectResumeRecentWork(7, chats, sessions).chats.map(row => row.id), [6]);
  assert.deepEqual(projectResumeRecentWork(0, chats, sessions), { chats: [], sessions: [] });
  assert.equal(projectResumeRecentWork(4, chats, sessions, 999).chats.length, 5);
  assert.equal(projectResumeRecentWork(4, chats, sessions, Number.NaN).chats.length, 4);
});

test("A09 invalid timestamps sort last without guessing a date or leaking foreign work", () => {
  const rows = [chat(20, 4, "invalid-date"), chat(21, 4, "2026-10-27T08:00:00Z"),
    chat(22, 4, "2026-10-26T08:00:00Z")];
  assert.deepEqual(projectResumeRecentWork(4, rows, []).chats.map(row => row.id), [21, 22, 20]);
});

test("P6 recorded follow-ups require exact Project identity; all recommendations remain source-owned", () => {
  const item = { id: "next", title: "Review decision", priority: "high", summary: "Saved objective",
    sourceRefs: ["source-a"], artifactRefs: [], decisionArtifactId: "artifact:owned", workflowId: null, kind: "complete_decision", deterministic: true };
  const snapshot = { projectId: 5, graph: { projectId: 5 }, dependencies: { projectId: 5 },
    continuationQueue: [item], counts: { continuationItems: 1 } } as unknown as P6ProjectContinuitySnapshot;
  assert.equal(projectResumeItems(5, snapshot)[0].id, "next");
  assert.equal(projectResumeItems(6, snapshot).length, 0);
  assert.equal(projectResumeItems(5, { ...snapshot, graph: { ...snapshot.graph, projectId: 6 } }).length, 0);
  assert.deepEqual(projectResumeItems(5, undefined), []);
});

test("Watchrooms exclude foreign workflow, run and notification identities", () => {
  const rooms = [workflow("local", 5), workflow("paused", 5, false), workflow("foreign", 6)];
  const runs = [run("old", "local", 5, "succeeded", "2026-10-26T10:00:00Z"),
    run("new", "local", 5, "failed", "2026-10-27T10:00:00Z"),
    run("intruder", "local", 6, "failed", "2026-10-28T10:00:00Z"),
    run("foreign", "foreign", 6, "succeeded", "2026-10-27T12:00:00Z")];
  const notifications = [note("allowed", "local", 5), note("read", "local", 5, "2026-10-27T09:00:00Z"),
    note("foreign-project", "local", 6), note("foreign-workflow", "foreign", 5)];
  const summary = projectWatchroomSummary(5, rooms, runs, notifications);
  assert.equal(summary.rooms.length, 2);
  assert.equal(summary.enabled, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.rooms[0].latestRun?.id, "new");
  assert.equal(summary.rooms[1].state.state, "paused");
  assert.deepEqual(summary.unread.map(item => item.id), ["allowed"]);
  assert.deepEqual(rooms.map(item => item.id), ["local", "paused", "foreign"]);
});

test("workflow enabled state never reports successful execution without a server run", () => {
  const { rooms } = projectWatchroomSummary(5, [workflow("alone", 5)], [], []);
  assert.equal(rooms[0].state.state, "enabled");
  assert.equal(rooms[0].latestRun, null);
  assert.match(rooms[0].state.warning, /not a guarantee of future execution/i);
});

test("Smart Watchroom history contains only actual same-project workflow runs ordered by recorded start", () => {
  const history = watchroomRecordedHistory(5, "local", [
    run("newest", "local", 5, "failed", "2026-10-27T11:00:00Z"),
    run("foreign-project", "local", 8, "succeeded", "2026-10-27T13:00:00Z"),
    run("foreign-workflow", "different", 5, "succeeded", "2026-10-27T14:00:00Z"),
    run("invalid-time", "local", 5, "succeeded", "not-a-timestamp"),
    run("oldest", "local", 5, "succeeded", "2026-10-27T09:00:00Z"),
    run("ongoing", "local", 5, "running", "2026-10-27T10:00:00Z"),
  ]);
  assert.deepEqual(history.map(entry => entry.id), ["oldest", "ongoing", "newest"]);
  assert.deepEqual(history.map(entry => entry.status), ["succeeded", "running", "failed"]);
  assert.deepEqual(watchroomRecordedHistory(8, "missing", [], 12), []);
  assert.deepEqual(watchroomRecordedHistory(5, "local", [run("foreign", "local", 8, "succeeded", "2026-10-27T10:00:00Z")]), []);
});

test("P9 monitoring chronology ignores ambiguous, impossible or unzoned dates rather than inventing run times", () => {
  const candidates = [
    run("short", "owned", 5, "succeeded", "1"),
    run("rollover", "owned", 5, "succeeded", "2026-02-30T09:00:00Z"),
    run("local-guess", "owned", 5, "succeeded", "2026-10-27T09:00:00"),
    run("date-only", "owned", 5, "succeeded", "2026-10-27"),
    run("hour-24", "owned", 5, "succeeded", "2026-10-27T24:00:00Z"),
    run("leap-day", "owned", 5, "succeeded", "2024-02-29T09:00:00Z"),
    run("offset", "owned", 5, "failed", "2026-10-27T15:30:00+05:30"),
    run("foreign", "owned", 6, "succeeded", "2026-10-28T09:00:00Z"),
  ];
  assert.deepEqual(watchroomRecordedHistory(5, "owned", candidates).map(item => item.id),
    ["leap-day", "offset"]);
  const summary = projectWatchroomSummary(5, [workflow("owned", 5)], candidates, []);
  assert.equal(summary.rooms[0].latestRun?.id, "offset");
  assert.equal(summary.failed, 1);
});

test("Smart Watchroom visual history enforces a bounded source-recorded window, never fabricates gaps", () => {
  const source = Array.from({ length: 40 }, (_, i) =>
    run("run-" + i, "owned", 5, i % 2 ? "failed" : "skipped", new Date(Date.UTC(2026, 9, 27, 0, i)).toISOString()));
  assert.deepEqual(watchroomRecordedHistory(5, "owned", source).map(entry => entry.id),
    source.slice(28).map(entry => entry.id));
  assert.equal(watchroomRecordedHistory(5, "owned", source, 1000).length, 24);
  assert.equal(watchroomRecordedHistory(5, "owned", source, Number.NaN).length, 12);
  assert.equal(watchroomRecordedHistory(5, "owned", [], 12).length, 0);
  assert.deepEqual(source.map(entry => entry.id)[0], "run-0");
});

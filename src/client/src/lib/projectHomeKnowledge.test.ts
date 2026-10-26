import test from "node:test";
import assert from "node:assert/strict";
import type { ProjectChat, ProjectResource, ProjectSession } from "./useProjects";
import { contextChangeConfirmation, findProjectHomeItems, mayEditProjectResourceContext, projectResourceContextOption } from "./projectHomeKnowledge";
import { assertProjectContinuitySnapshot } from "./useP6Continuity";

const chat = (id: number, projectId: number | null, title: string, status = "active"): ProjectChat =>
  ({ id, projectId, title, status, scope: "project" }) as ProjectChat;
const resource = (id: string, projectId: number, label: string, contextMode: ProjectResource["contextMode"] = "project", status = "active"): ProjectResource =>
  ({ id, projectId, label, contextMode, status, kind: "document" }) as ProjectResource;
const session = (id: string, projectId: number, name: string, status = "active"): ProjectSession =>
  ({ id, projectId, name, status }) as ProjectSession;

test("Project Home search cannot expose foreign or trashed records from an accidentally mixed cache", () => {
  const chats = [
    chat(1, 12, "Quarterly filing"),
    chat(2, 13, "SECRET OTHER PROJECT filing"),
    chat(3, 12, "Old filing", "archived"),
    chat(4, null, "Quick chat filing"),
  ];
  const resources = [
    resource("a", 12, "Issuer filing"),
    resource("b", 13, "SECRET OTHER PROJECT filing"),
    resource("c", 12, "Archived source", "excluded", "archived"),
    resource("d", 12, "Excluded source", "excluded"),
  ];
  const sessions = [
    session("q1", 12, "Risk baseline"),
    session("q2", 13, "SECRET OTHER PROJECT risk"),
    session("q3", 12, "Archived risk", "archived"),
  ];
  const filtered = findProjectHomeItems(12, chats, resources, sessions, "");
  assert.deepEqual(filtered.chats.map(x => x.id), [1]);
  assert.deepEqual(filtered.resources.map(x => x.id), ["a", "d"]);
  assert.deepEqual(filtered.sessions.map(x => x.id), ["q1"]);
  assert.ok(!JSON.stringify(filtered).includes("SECRET OTHER PROJECT"));
  assert.deepEqual(findProjectHomeItems(13, chats, resources, sessions, "filing").chats.map(x => x.id), [2]);
  assert.deepEqual(findProjectHomeItems(99, chats, resources, sessions, ""), { chats: [], resources: [], sessions: [] });
});

test("local find uses title/label/resource kind without searching external Project content", () => {
  const chats = [chat(1, 12, "Audited Valuation"), chat(2, 12, "Portfolio review")];
  const resources = [resource("r1", 12, "SEC 10-K", "on_demand"), resource("r2", 12, "Excluded policy", "excluded")];
  const sessions = [session("s1", 12, "Valuation base")];
  assert.deepEqual(findProjectHomeItems(12, chats, resources, sessions, " valuatION ").chats.map(x => x.id), [1]);
  assert.deepEqual(findProjectHomeItems(12, chats, resources, sessions, " valuatION ").sessions.map(x => x.id), ["s1"]);
  assert.deepEqual(findProjectHomeItems(12, chats, resources, sessions, "document").resources.map(x => x.id), ["r1", "r2"]);
  assert.deepEqual(findProjectHomeItems(12, chats, resources, sessions, "on demand").resources.map(x => x.id), ["r1"]);
});

test("a context edit must be an explicit changed mode for a current, active, matching Project resource", () => {
  const active = resource("a", 12, "Issuer filing", "excluded");
  assert.equal(mayEditProjectResourceContext(12, active, "project"), true);
  assert.equal(mayEditProjectResourceContext(12, active, "on_demand"), true);
  assert.equal(mayEditProjectResourceContext(12, active, "excluded"), false);
  assert.equal(mayEditProjectResourceContext(13, active, "project"), false);
  assert.equal(mayEditProjectResourceContext(0, active, "project"), false);
  assert.equal(mayEditProjectResourceContext(12, undefined, "project"), false);
  assert.equal(mayEditProjectResourceContext(12, resource("q", 12, "Deleted", "excluded", "trash"), "project"), false);
  const statement = contextChangeConfirmation(active.label, "excluded", "project");
  assert.match(statement, /Issuer filing/);
  assert.match(statement, /eligible for automatic Project context retrieval/i);
  assert.match(statement, /does not authorize a workflow rerun/);
  assert.match(projectResourceContextOption("on_demand").detail, /explicit task/);
  assert.match(projectResourceContextOption("excluded").detail, /does not delete external source data/);
});

test("continuity snapshot validation fails closed for foreign graph, dependencies or top-level Project ID", () => {
  const valid = {
    schemaVersion: "1",
    projectId: 12,
    generatedAt: "2026-10-24T12:00:00.000Z",
    fingerprint: "a".repeat(64),
    dependencies: { projectId: 12, projectName: "Owned Project", chats: 0, resources: 0, sessions: 0, artifacts: 0, total: 0 },
    graph: { projectId: 12, nodes: [], edges: [] },
    sessions: [], decisions: [], automations: [], changeSummary: null, continuationQueue: [],
    counts: { graphNodes: 0, graphEdges: 0, sessions: 0, branchedSessions: 0, decisions: 0, unresolvedDecisions: 0, activeAutomations: 0, failedAutomations: 0, continuationItems: 0 },
  };
  const parsed = assertProjectContinuitySnapshot(valid, 12);
  assert.equal(parsed.projectId, 12);
  assert.throws(() => assertProjectContinuitySnapshot(valid, 13), /another Project/);
  assert.throws(() => assertProjectContinuitySnapshot({ ...valid, graph: { projectId: 13, nodes: [], edges: [] } }, 12), /another Project/);
  assert.throws(() => assertProjectContinuitySnapshot({ ...valid, dependencies: { ...valid.dependencies, projectId: 13 } }, 12), /another Project/);
  assert.throws(() => assertProjectContinuitySnapshot({ ...valid, counts: { ...valid.counts, decisions: -1 } }, 12));
  assert.throws(() => assertProjectContinuitySnapshot(valid, 0), /current Project/);
  assert.throws(() => assertProjectContinuitySnapshot(undefined, 12));
});
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ProjectChat, ProjectResource, ProjectSession } from "./useProjects";
import { contextChangeConfirmation, findProjectHomeItems, mayEditProjectResourceContext, projectResourceContextOption } from "./projectHomeKnowledge";

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

test("original Project Home uses only scoped records and confirms exact one-resource server patch", () => {
  const source = readFileSync(new URL("../components/terminal/ProjectHome.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../../server/projectRoutes.ts", import.meta.url), "utf8");
  assert.match(source, /findProjectHomeItems\(project\.id, chats, resources, sessions, workQuery\)/);
  assert.match(source, /data-testid="project-scoped-discovery"/);
  assert.match(source, /found\.chats\.slice\(0, 8\)/);
  assert.match(source, /found\.resources\.slice\(0, 6\)/);
  assert.match(source, /found\.sessions\.slice\(0, 6\)/);
  assert.match(source, /data-testid="project-context-review"/);
  assert.match(source, /mayEditProjectResourceContext\(draft\.projectId, resource, draft\.to\)/);
  assert.match(source, /updateProjectResource\(draft\.projectId, draft\.resourceId, \{ contextMode: draft\.to \}\)/);
  assert.match(source, /saved\.projectId !== draft\.projectId \|\| saved\.id !== draft\.resourceId \|\| saved\.contextMode !== draft\.to/);
  assert.match(source, /selectedProjectId\.current !== draft\.projectId/);
  assert.match(source, /queryKey: \["\/api\/projects", draft\.projectId, "resources"\], exact: true/);
  assert.match(source, /<ProjectContinuityPanel key=\{project\.id\} projectId=\{project\.id\}/);
  assert.doesNotMatch(source, /promoteQuickChat\(|trashProject\(|permanentlyDeleteProject\(/);
  assert.match(route, /if \(resource\.projectId !== projectId\) throw new Error\("Project resource boundary violation\."\)/);
  assert.match(route, /setProjectResourceContextMode\(ctx\(req\), req\.params\.resourceId, body\.contextMode\)/);
});

test("canonical Project Continuity retrieval and refresh reject cross-Project or malformed snapshots", () => {
  const source = readFileSync(new URL("./useP6Continuity.ts", import.meta.url), "utf8");
  const component = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  assert.match(source, /p6ProjectContinuitySnapshotSchema\.parse\(payload\)/);
  assert.match(source, /parsed\.projectId !== projectId \|\| parsed\.graph\.projectId !== projectId \|\| parsed\.dependencies\.projectId !== projectId/);
  assert.match(source, /assertProjectContinuitySnapshot\(await res\.json\(\), projectId!\)/);
  assert.match(source, /assertProjectContinuitySnapshot\(await response\.json\(\), projectId\)/);
  assert.match(component, /Recompute this Project snapshot/);
  assert.match(component, /does not change other Projects or resume agents/);
  assert.match(component, /snapshot \? snapshot\.counts\.decisions : "—"/);
  assert.match(component, /could not be loaded or did not match its identity/);
});

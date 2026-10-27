import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectChat, ProjectSession } from "@/lib/useProjects";
import { ProjectResumeDesk } from "./ProjectResumeDesk";

function chat(id: number, projectId: number, time: string): ProjectChat {
  return { id, projectId, ownerUserId: 1, organizationId: null,
    scope: "project", title: "Real conversation " + id, pinned: false,
    status: "active", lastActivityAt: time, createdAt: time, updatedAt: time,
    archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null };
}
function session(id: string, projectId: number, time: string): ProjectSession {
  return { id, projectId, chatId: null, parentSessionId: null, ownerUserId: 1,
    organizationId: null, name: "Saved session " + id, status: "active",
    workspaceState: {} as ProjectSession["workspaceState"], createdAt: time,
    updatedAt: time, archivedAt: null, trashedAt: null, trashedByProjectId: null, trashedFromStatus: null };
}
function renderResume(chats: ProjectChat[], sessions: ProjectSession[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(ProjectResumeDesk, {
      projectId: 3, chats, sessions, onOpenChat: () => undefined,
      onOpenSession: () => undefined, onFocusArtifact: () => undefined,
      onInspectContinuity: () => undefined, onOpenWatchrooms: () => undefined,
    })));
}

test("A09 resume desk exposes several active saved items from only this Project", () => {
  const html = renderResume([
    chat(1, 3, "2026-10-25T00:00:00Z"),
    chat(2, 3, "2026-10-27T00:00:00Z"),
    chat(3, 7, "2026-10-28T00:00:00Z"),
    { ...chat(4, 3, "2026-10-29T00:00:00Z"), status: "archived" },
  ], [
    session("today", 3, "2026-10-27T00:00:00Z"),
    session("earlier", 3, "2026-10-26T00:00:00Z"),
    session("foreign", 7, "2026-10-30T00:00:00Z"),
  ]);
  assert.match(html, /Continue work/);
  assert.match(html, /Real conversation 1/);
  assert.match(html, /Real conversation 2/);
  assert.match(html, /Saved session today/);
  assert.match(html, /Saved session earlier/);
  assert.match(html, /More saved work/);
  assert.match(html, /Checking recorded Project next steps/);
  assert.doesNotMatch(html, /Real conversation 3|Real conversation 4|Saved session foreign/);
});

test("A09 empty Project does not display artificial resume rows or tasks", () => {
  const html = renderResume([], []);
  assert.doesNotMatch(html, /Continue work|Saved session|More saved work|source reference/);
});

test("A09 continuation retry is read-only and exact Project/source owned", () => {
  const src = readFileSync(new URL("./ProjectResumeDesk.tsx", import.meta.url), "utf8");
  assert.match(src, /projectResumeRecentWork\(projectId, chats, sessions, 4\)/);
  assert.match(src, /onOpenChat\(row\)/);
  assert.match(src, /onOpenSession\(row\)/);
  assert.match(src, /continuity\.refetch\(\)/);
  assert.match(src, /Retry read-only history/);
  assert.doesNotMatch(src, /createProject|recomputeProject|runP9WorkflowNow|localStorage/);
});

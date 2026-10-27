import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { P9WorkflowRecord, P9RunRecord, P9NotificationRecord } from "@/lib/useP9Automation";
import { ProjectWatchroomDesk } from "./ProjectWatchroomDesk";

const workflow: P9WorkflowRecord = {
  id: "workflow:one", projectId: 7, ownerUserId: 10, organizationId: null,
  name: "Project delta watchroom", description: "Retained snapshot comparison", template: "custom",
  enabled: true, trigger: { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } },
  action: { kind: "project_what_changed" },
  notificationPolicy: { enabled: true, channels: ["in_app"], notifyOn: ["change_detected"], minimumRelevanceScore: 0.5, cooldownMinutes: 60, suppressUnchanged: true },
  sourceRefs: [], engineRefs: [], artifactRefs: [], eventCursor: {}, nextRunAt: null, lastRunAt: null,
  lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0,
  createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T05:00:00Z",
};
const run: P9RunRecord = {
  id: "run:1", workflowId: workflow.id, projectId: 7, triggerType: "manual", status: "succeeded",
  startedAt: "2026-10-27T05:00:00Z", completedAt: "2026-10-27T05:01:00Z",
  summary: "Saved source changed", changed: true, conditionMet: true, relevanceScore: 0.7,
  sourceRefs: ["source:real"], engineRefs: [], artifactRefs: [], executionReceiptIds: ["receipt:one"], output: {}, error: null,
};
const notification: P9NotificationRecord = {
  id: "notification:1", workflowId: workflow.id, runId: run.id, projectId: 7, channel: "in_app",
  status: "delivered", reason: "change_detected", title: "Recorded change detected",
  body: "A previously tracked source changed", relevanceScore: 0.8, readAt: null,
  createdAt: "2026-10-27T05:01:00Z",
};

test("Project Watchrooms render current P9 evidence, not invented live execution", () => {
  const client = new QueryClient();
  client.setQueryData(["/api/projects", 7, "automation", "workflows"], [workflow]);
  client.setQueryData(["/api/projects", 7, "automation", "runs"], [run]);
  client.setQueryData(["/api/projects", 7, "automation", "notifications"], [notification]);
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(ProjectWatchroomDesk, { projectId: 7 })));
  assert.match(html, /Project delta watchroom/);
  assert.match(html, /Enabled means a saved monitoring intention, not a confirmed run/);
  assert.match(html, /1 saved · 1 enabled · 1 unread notification/);
  assert.match(html, /Saved source changed/);
  assert.match(html, /1 execution receipt IDs/);
  assert.match(html, /Recorded change detected/);
  assert.match(html, /Manage watchrooms/);
  assert.doesNotMatch(html, /runP9WorkflowNow\(|auto-enable|<img\b/);
});

test("Watchrooms show a read-only initial loading state without making up results", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const html = renderToStaticMarkup(createElement(QueryClientProvider, { client },
    createElement(ProjectWatchroomDesk, { projectId: 7 })));
  assert.match(html, /Loading saved Project monitoring records/);
  assert.doesNotMatch(html, /No saved Watchrooms in this Project|Recorded change detected/);
});

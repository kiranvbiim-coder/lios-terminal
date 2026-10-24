import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { P9NotificationRecord } from "./useP9Automation";
import { projectNotificationHistory, p9NotificationReasonLabel } from "./p9NotificationHistory";
import { P9NotificationHistory } from "../components/terminal/P9NotificationHistory";

function notification(id: string, projectId: number, overrides: Partial<P9NotificationRecord> = {}): P9NotificationRecord {
  return {
    id, projectId, workflowId: "workflow:owned", runId: "workflow-run:original",
    channel: "in_app", status: "delivered", reason: "change_detected",
    title: "Sensitive title, never in OS banner",
    body: "Confidential forecast sk-proj-ABCDEF0123456789",
    relevanceScore: 0.85,
    readAt: null,
    createdAt: "2026-10-24T10:00:00.000Z",
    ...overrides,
  };
}

test("Project history refuses all other Projects and separates delivered, suppressed, unread and read", () => {
  const rows = [
    notification("workflow-notification:1", 7),
    notification("workflow-notification:2", 7, { status: "suppressed", readAt: null, relevanceScore: 0.2 }),
    notification("workflow-notification:3", 7, { status: "delivered", readAt: "2026-10-24T11:00:00Z", reason: "failure" }),
    notification("workflow-notification:secret", 11, { title: "Secret foreign Project" }),
  ];
  const history = projectNotificationHistory(7, rows, "all");
  assert.equal(history.delivered, 2);
  assert.equal(history.suppressed, 1);
  assert.equal(history.read, 1);
  assert.equal(history.unread, 1);
  assert.deepEqual(history.items.map(x => x.id), rows.slice(0, 3).map(x => x.id));
  assert.ok(!JSON.stringify(history).includes("Secret foreign Project"));
  assert.ok(!JSON.stringify(history).includes("Confidential forecast"));
  assert.ok(!JSON.stringify(history).includes("Sensitive title"));
  assert.equal(history.items[1].inAppLabel, "Suppressed by P9 policy · no in-app alert was delivered");
  assert.equal(history.items[1].readLabel, "Not applicable");
  assert.equal(history.items[2].readLabel, "Marked read on server");
  assert.deepEqual(projectNotificationHistory(7, rows, "suppressed").items.map(x => x.id), [rows[1].id]);
  assert.deepEqual(projectNotificationHistory(7, rows, "delivered").items.map(x => x.id), [rows[0].id, rows[2].id]);
  assert.deepEqual(projectNotificationHistory(100, rows, "all").items, []);
  assert.deepEqual(projectNotificationHistory(-1, rows, "all").items, []);
});

test("material change, conditions, failures and successes are not conflated", () => {
  assert.match(p9NotificationReasonLabel("change_detected"), /materiality/);
  assert.match(p9NotificationReasonLabel("condition_met"), /inspect evidence/);
  assert.match(p9NotificationReasonLabel("failure"), /review run/);
  assert.match(p9NotificationReasonLabel("success"), /no material change implied/);
  const record = notification("workflow-notification:1", 7, { relevanceScore: Number.NaN });
  assert.equal(projectNotificationHistory(7, [record], "all").items[0].relevance, null);
});

test("native OS delivery is always explicitly unverified and in-app marked-delivered never proves execution", () => {
  const rows = [notification("workflow-notification:1", 7, {
    status: "delivered", reason: "failure", relevanceScore: 1,
  })];
  const display = projectNotificationHistory(7, rows, "all");
  assert.equal(display.items[0].osLabel, "Native OS delivery unverified");
  assert.equal(display.items[0].inAppLabel, "Recorded as delivered in-app");
  assert.match(display.items[0].reasonLabel, /failure/);
  assert.equal(display.items[0].runId, "workflow-run:original");
  assert.equal(display.items[0].relevance, 1);
});

test("server-rendered history is privacy-forward and shows only project-scoped metadata", () => {
  const markup = renderToStaticMarkup(createElement(P9NotificationHistory, {
    projectId: 7,
    notifications: [
      notification("workflow-notification:1", 7),
      notification("workflow-notification:2", 7, { status: "suppressed" }),
      notification("workflow-notification:secret", 11, { title: "Secret foreign Project" }),
    ],
    busy: false, onRead: () => {}, onRefetch: () => {},
  }));
  for (const text of ["Notification delivery and history", "1 in-app delivered", "1 suppressed", "Native OS delivery", "Inspect Project notification records", "generic LiOS text"]) {
    assert.ok(markup.includes(text), `missing copy: ${text}`);
  }
  assert.ok(!markup.includes("Secret foreign Project"));
  assert.ok(!markup.includes("Confidential forecast"));
  assert.ok(!markup.includes("Sensitive title"));
  assert.match(markup, /data-testid="p9-notification-history"/);
  assert.match(markup, /2 loaded/);
  assert.match(markup, /Suppressed by P9 policy/);
  assert.match(markup, /Mark in-app notification read/);
  assert.doesNotMatch(markup, /workflow-notification:secret/);
});

test("original P9 panel retains server-owned read status and history; native permission prompts only on user click", () => {
  const code = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../components/terminal/P9NotificationHistory.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("./useP9Automation.ts", import.meta.url), "utf8");
  const desktop = readFileSync(new URL("./p9DesktopNotifications.ts", import.meta.url), "utf8");
  assert.match(code, /<P9NotificationHistory key=\{projectId\} projectId=\{projectId\}/);
  assert.match(code, /onRead=\{notificationId => void markNotificationRead\(notificationId\)\}/);
  assert.match(code, /item.projectId === projectId && item.status === "delivered"/);
  assert.match(ui, /data-testid="p9-desktop-permission-opt-in"/);
  assert.match(ui, /onClick=\{requestDesktopPermission\}/);
  assert.match(ui, /requestP9DesktopPermissionFromGesture\(\)/);
  assert.match(desktop, /passivePermission\(port\)/);
  assert.match(client, /GET|fetch\(\x60\/api\/projects\/\$\{projectId\}\/automation\/notifications\?limit=100/);
  assert.match(client, /markP9NotificationRead/);
  assert.doesNotMatch(ui, /new Notification\(|useEffect\(.*requestPermission/);
});

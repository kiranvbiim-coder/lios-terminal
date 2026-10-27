import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");

test("P9 notices always carry originating Project identity and render only under matching Project", () => {
  assert.match(panel, /const \[messageReceipt, setMessageReceipt\] = useState<\{ projectId: number; text: string \} \| null>\(null\)/);
  assert.match(panel, /const message = messageReceipt\?\.projectId === projectId \? messageReceipt\.text : null;/);
  assert.match(panel, /const setMessage = \(text: string \| null\) => \{/);
  assert.match(panel, /if \(selectedProject\.current !== projectId\) return;/);
  assert.match(panel, /setMessageReceipt\(text === null \? null : \{ projectId, text \}\);/);
});

test("late P9 manual results, draft receipts and error notices use guarded presentation setter", () => {
  assert.match(panel, /const selectedProject = useRef\(projectId\);\s+selectedProject\.current = projectId;/);
  assert.equal((panel.match(/\bsetMessageReceipt\(/g) ?? []).length, 1, "every notice must go through the owner guard");
  const start = panel.indexOf("  const run = async ");
  const end = panel.indexOf("  const createTemplate = async ", start);
  const manual = panel.slice(start, end);
  assert.ok(start >= 0 && end > start);
  for (const operation of ["runP9WorkflowNow(", "prepareP9ManualRunConfirmation(", "checkP9ManualRunAttempt(", "markP9NotificationRead("]) {
    assert.ok(manual.includes(operation), \`expected original manual-action integration: \${operation}\`);
  }
  assert.ok((manual.match(/\bsetMessage\(/g) ?? []).length >= 9);
  assert.doesNotMatch(manual, /setMessageReceipt\(/);
});

test("status scoping changes neither P9 execution authorization nor manual idempotency receipts", () => {
  assert.match(panel, /await runP9WorkflowNow\(projectId, id, \{\s+idempotencyKey: requestKey,\s+expectedUpdatedAt: draft\.expectedUpdatedAt,/);
  assert.match(panel, /if \(!prepareP9ManualRunAttempt\(projectId, id, requestKey\)\)/);
  assert.match(panel, /const confirmWorkflowReview = async \(\) =>/);
  assert.match(panel, /candidate\.projectId !== projectId/);
  assert.match(panel, /if \(selectedProject\.current === originalProject\)/);
});

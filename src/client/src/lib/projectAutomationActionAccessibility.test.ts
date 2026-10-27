import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
const row = source.slice(source.indexOf("{workflows.map((workflow) => {"), source.indexOf("{!workflows.length && ("));

test("existing P9 workflow actions are named, 44px and keyboard-visible", () => {
  assert.match(row, /role="group" aria-label=\{\`Actions for \$\{workflow\.name\}\`\}/);
  assert.match(row, /aria-label=\{\`Run \$\{workflow\.name\} now — explicit manual action\`\}/);
  assert.match(row, /aria-label=\{\`Review deletion of \$\{workflow\.name\}\`\}/);
  assert.match(row, />\s*Run now\s*<\/button>/);
  assert.match(row, />\s*Review delete\s*<\/button>/);
  assert.match(row, /"Review event trigger" : "Review schedule"/);
  assert.match(row, /min-h-11/g);
  assert.match(row, /focus-visible:outline/g);
  assert.match(row, /motion-safe:animate-spin/);
});

test("actions wrap below workflow details in narrow panes without a second drawer", () => {
  assert.match(row, /flex flex-wrap items-start gap-3/);
  assert.match(row, /flex w-full flex-wrap items-center gap-2 border-t border-border\/40 pt-3 sm:w-auto sm:border-0 sm:pt-0/);
  assert.match(row, /min-h-11 min-w-11/);
  assert.match(row, /data-p9-workflow-id=\{workflow\.id\} tabIndex=\{-1\}/);
});

test("P9 controls retain exact original action ownership and review-before-change semantics", () => {
  assert.match(row, /onClick=\{\(\) => void run\(workflow\.id, workflow\.updatedAt\)\}/);
  assert.match(row, /onClick=\{\(\) => requestWorkflowReview\(workflow, workflow\.enabled \? "pause" : "resume"\)\}/);
  assert.match(row, /onClick=\{\(\) => requestWorkflowReview\(workflow, "edit"\)\}/);
  assert.match(row, /onClick=\{\(\) => requestWorkflowReview\(workflow, "delete"\)\}/);
  assert.match(source, /const confirmWorkflowReview = async \(\) =>/);
  assert.match(source, /expectedUpdatedAt: workflow\.updatedAt/);
  assert.doesNotMatch(row, /setP9WorkflowEnabled|deleteP9Workflow|replaceP9Workflow/);
});

test("manual execution and destructive review do not fire from source-derived render or focus", () => {
  const rowBeforeActions = row.slice(0, row.indexOf('<div role="group"'));
  assert.doesNotMatch(rowBeforeActions, /void run\(workflow\.id/);
  assert.doesNotMatch(rowBeforeActions, /deleteP9Workflow\(/);
  assert.match(row, /disabled=\{Boolean\(busyId\)\}/);
  assert.match(row, /disabled=\{Boolean\(busyId\) \|\| workflow\.trigger\.type === "manual"\}/);
});

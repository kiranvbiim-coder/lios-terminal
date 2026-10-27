import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { findProjectWorkflowRow, focusProjectWorkflowRow } from "./projectWorkflowFocus";

function fakeWorkflowDocument(scopes: Array<{ projectId: number; workflows: string[] }>) {
  const attempts: Array<{ workflowId: string; scroll?: unknown; focus?: unknown }> = [];
  const panels = scopes.map(scope => ({
    getAttribute: (name: string) => name === "data-p9-project-id" ? String(scope.projectId) : null,
    querySelectorAll: (_selector: string) => scope.workflows.map(workflowId => {
      const record: { workflowId: string; scroll?: unknown; focus?: unknown } = { workflowId };
      attempts.push(record);
      return {
        getAttribute: (name: string) => name === "data-p9-workflow-id" ? workflowId : null,
        scrollIntoView: (options: unknown) => { record.scroll = options; },
        focus: (options: unknown) => { record.focus = options; },
      };
    }),
  }));
  const root = {
    querySelectorAll: (_selector: string) => panels,
  } as unknown as ParentNode;
  return { root, attempts };
}

test("P6→P9 review resolves exact workflow within exact Project, not an identical ID in another Project", () => {
  const { root } = fakeWorkflowDocument([
    { projectId: 15, workflows: ["shared-workflow"] },
    { projectId: 25, workflows: ["different", "shared-workflow"] },
  ]);
  const row = findProjectWorkflowRow(root, 25, "shared-workflow");
  assert.ok(row);
  assert.equal(row.getAttribute("data-p9-workflow-id"), "shared-workflow");
  assert.equal(findProjectWorkflowRow(root, 25, "missing"), null);
  assert.equal(findProjectWorkflowRow(root, 26, "shared-workflow"), null);
  assert.equal(findProjectWorkflowRow(root, 0, "shared-workflow"), null);
});

test("opaque workflow IDs are never interpolated into CSS selectors or treated as substrings", () => {
  const raw = 'run-\"quoted\"#[]:has(button)';
  const { root } = fakeWorkflowDocument([{ projectId: 8, workflows: ["run", raw] }]);
  assert.equal(findProjectWorkflowRow(root, 8, raw)?.getAttribute("data-p9-workflow-id"), raw);
  assert.equal(findProjectWorkflowRow(root, 8, raw + "-other"), null);
  assert.equal(findProjectWorkflowRow(root, 8, " run"), null);
});

test("focus handoff moves to exact row, uses reduced-motion-safe scrolling, never triggers execution", () => {
  const fixture = fakeWorkflowDocument([{ projectId: 7, workflows: ["a", "b"] }]);
  assert.equal(focusProjectWorkflowRow(fixture.root, 7, "b", true), true);
  const matched = fixture.attempts.find(a => a.workflowId === "b");
  assert.deepEqual(matched?.scroll, { behavior: "auto", block: "center" });
  assert.deepEqual(matched?.focus, { preventScroll: true });
  assert.equal(fixture.attempts.find(a => a.workflowId === "a")?.focus, undefined);

  const smooth = fakeWorkflowDocument([{ projectId: 7, workflows: ["b"] }]);
  assert.equal(focusProjectWorkflowRow(smooth.root, 7, "b", false), true);
  assert.deepEqual(smooth.attempts[0].scroll, { behavior: "smooth", block: "center" });
  assert.equal(focusProjectWorkflowRow(smooth.root, 7, "unavailable", false), false);
});

test("actual Project Continuity consumer and P9 rows preserve exact identity and visible no-op failure", () => {
  const continuity = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  const automation = readFileSync(new URL("../components/terminal/ProjectAutomationPanel.tsx", import.meta.url), "utf8");
  assert.match(continuity, /focusProjectWorkflowRow\(document, projectId, workflowId, prefersReducedMotion\)/);
  assert.match(continuity, /onReviewWorkflow=\{reviewExactWorkflow\}/);
  assert.match(continuity, /Nothing was run or changed/);
  assert.match(continuity, /role="status"/);
  assert.doesNotMatch(continuity, /document\.querySelector\("\[data-p9-continuous-intelligence\]"/);
  assert.match(automation, /data-p9-project-id=\{projectId\}/);
  assert.match(automation, /data-p9-workflow-id=\{workflow\.id\}/);
  assert.match(automation, /tabIndex=\{-1\}/);
  assert.match(automation, /aria-label=\{\`Saved workflow \$\{workflow\.name\}\`\}/);
});

test("continuity surrounding controls no longer rely on illegibly small 6–8px typography", () => {
  const continuity = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(continuity, /text-\[(?:6|7|8)px\]/);
  assert.match(continuity, /min-h-11/);
  assert.match(continuity, /motion-safe:animate-spin/);
  assert.match(continuity, /text-muted-foreground/);
});

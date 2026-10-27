import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/terminal/ProjectContinuityPanel.tsx", import.meta.url), "utf8");
const query = readFileSync(new URL("./useP6Continuity.ts", import.meta.url), "utf8");
const start = panel.indexOf("{continuity.isError && (");
const end = panel.indexOf('<div className="mt-3 grid grid-cols-2', start);
const recovery = panel.slice(start, end);

test("failed P6 reads offer a real, accessible read-only retry", () => {
  assert.ok(start > 0 && end > start, "error-state recovery must exist");
  assert.ok(recovery.includes('role="alert"'));
  assert.ok(recovery.includes('type="button"'));
  assert.ok(recovery.includes("onClick={() => void continuity.refetch()}"));
  assert.ok(recovery.includes('disabled={continuity.isFetching}'));
  assert.ok(recovery.includes('aria-busy={continuity.isFetching}'));
  assert.ok(recovery.includes("Retry read-only load"));
  assert.ok(recovery.includes("Retrying read…"));
  assert.ok(recovery.includes("focus-visible:outline"));
  assert.ok(recovery.includes("min-h-11"));
});

test("P6 read-only recovery never calls snapshot recompute or any workflow mutation", () => {
  assert.ok(recovery.includes("does not recompute or create a snapshot"));
  for (const forbidden of ["refreshP6ProjectContinuity(", "runP9WorkflowNow(", "invalidate(", "onClick={() => void refresh()}"]) {
    assert.ok(!recovery.includes(forbidden), `recovery must not perform mutation: ${forbidden}`);
  }
  assert.ok(panel.includes("onClick={() => void refresh()}"), "explicit write action must remain separate");
  assert.ok(panel.includes("await refreshP6ProjectContinuity(requestedProjectId)"), "explicit snapshot refresh must retain exact Project scope");
});

test("the canonical P6 retry query is a GET with strict Project identity validation", () => {
  assert.ok(query.includes('fetch(`/api/projects/${projectId}/continuity`)'));
  assert.ok(query.includes("if (!res.ok) throw new Error"));
  assert.ok(query.includes("assertProjectContinuitySnapshot(await res.json(), projectId!)"));
  assert.ok(query.includes("parsed.projectId !== projectId"));
  assert.ok(query.includes("parsed.graph.projectId !== projectId"));
  assert.ok(query.includes("parsed.dependencies.projectId !== projectId"));
});

test("an unreadable Project is not rendered as an empty saved snapshot", () => {
  assert.ok(panel.includes("const snapshot = !continuity.isError ? continuity.data : undefined"));
  assert.ok(panel.includes('unavailable={continuity.isError}'));
  assert.ok(panel.includes('snapshot ? `${snapshot.counts.unresolvedDecisions} open` : "Unavailable"'));
});

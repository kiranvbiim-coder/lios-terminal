import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { P6ChangeSummary } from "@shared/p6ContinuityContracts";
import { ProjectChangeActivity } from "./ProjectChangeActivity";
import { projectChangePresentation } from "@/lib/projectChangePresentation";

function recorded(overrides: Partial<P6ChangeSummary> = {}): P6ChangeSummary {
  return {
    fromSnapshotId: "p6:project-7:rev1",
    toSnapshotId: "p6:project-7:rev2",
    added: 2, changed: 3, removed: 1,
    sourceRefs: ["source:filing-7", "source:research-5"],
    ...overrides,
  };
}

test("unavailable comparison must not become fabricated zeros or a made-up timestamp", () => {
  const view = projectChangePresentation(null);
  assert.equal(view.status, "unavailable");
  assert.equal(view.total, null);
  const html = renderToStaticMarkup(createElement(ProjectChangeActivity, { summary: null }));
  assert.match(html, /No retained comparison is available/);
  assert.doesNotMatch(html, /Recorded change counts|source:|1970/);
});

test("the card displays exact retained aggregate counts and identities", () => {
  const view = projectChangePresentation(recorded());
  assert.equal(view.status, "changed");
  assert.deepEqual([view.total, view.added, view.changed, view.removed], [6, 2, 3, 1]);
  const html = renderToStaticMarkup(createElement(ProjectChangeActivity, { summary: recorded() }));
  assert.match(html, /6 recorded changes/);
  assert.match(html, /Recorded source references \(2\)/);
  assert.match(html, /p6:project-7:rev1/);
  assert.match(html, /p6:project-7:rev2/);
  assert.match(html, /source:filing-7/);
  assert.doesNotMatch(html, /href=/);
});

test("zero differences are not mistaken for missing comparison", () => {
  const zero = recorded({ added: 0, changed: 0, removed: 0, sourceRefs: [] });
  assert.equal(projectChangePresentation(zero).status, "unchanged");
  const html = renderToStaticMarkup(createElement(ProjectChangeActivity, { summary: zero }));
  assert.match(html, /No differences recorded between these two retained snapshots/);
  assert.match(html, /No source references attached/);
});

test("source references are read-only, escaped, bounded and never assigned fake delta types", () => {
  const refs = ["javascript:alert(1)", "<script>bad</script>", ...Array.from({ length: 14 }, (_, i) => `ref-${i}`)];
  const input = recorded({ sourceRefs: refs });
  const html = renderToStaticMarkup(createElement(ProjectChangeActivity, { summary: input }));
  assert.match(html, /Showing the first 12 references/);
  assert.match(html, /4 additional references/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|href=|ref-13/);
  assert.deepEqual(input.sourceRefs, refs);
});

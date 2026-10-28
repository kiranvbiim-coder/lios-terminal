import assert from "node:assert/strict";
import test from "node:test";
import type { PinnedBriefingVisual } from "./phase4BriefingVisuals";
import {
  buildProjectBriefingReport, currentProjectBriefingVisuals, isReviewedBriefingSourceCurrent, MAX_BRIEFING_SOURCES, type BriefingSource,
} from "./projectBriefingStoryboard";

const artifact = (id: string, version: number, projectId = 11): BriefingSource => ({
  id, headVersion: version, title: "Saved " + id, projectId,
  kind: "chart", status: "active",
});
const create = (sources: BriefingSource[]) => buildProjectBriefingReport({
  projectId: 11, title: "  Business briefing  ", introduction: "Question from analyst", sources,
});

test("reviewed storyboard is a normal editable Report with ordered exact-version source references", () => {
  const result = create([artifact("market", 3), artifact("research", 8)]);
  assert.equal(result.title, "Business briefing");
  assert.deepEqual(result.dependencyRefs, ["market", "research"]);
  assert.equal(result.content.kind, "report");
  assert.equal(result.content.editorPreference, "builtin");
  assert.equal(result.content.sections.length, 3);
  assert.deepEqual(result.content.sections.map(section => section.id), [
    "briefing-cover", "briefing-frame-1", "briefing-frame-2",
  ]);
  const refs = result.content.blocks.filter(block => block.type === "artifact_ref");
  assert.equal(refs.length, 2);
  assert.deepEqual(refs.map(block => [block.attrs.artifactId, block.attrs.artifactVersion, block.attrs.projectId]), [
    ["market", 3, 11], ["research", 8, 11],
  ]);
  assert.deepEqual(refs.map(block => block.attrs.referenceStatus), ["review_required", "review_required"]);
  assert.match(result.content.blocks[1].text, /Question from analyst/);
  assert.ok(result.content.blocks.every(block => !/stock photo|generated result|fabricated metrics/i.test(block.text)));
});

test("briefing respects the user's reviewed frame order rather than sorting by version", () => {
  const result = create([artifact("second", 2), artifact("first", 10)]);
  assert.equal(result.content.sections[1].title, "Frame 1: Saved second");
  assert.equal(result.content.sections[2].title, "Frame 2: Saved first");
  assert.deepEqual(result.dependencyRefs, ["second", "first"]);
});

test("no fake briefing is created without active, distinct, authorized Project sources", () => {
  assert.throws(() => create([]), /Select between 1 and 8/);
  assert.throws(() => create([artifact("a", 1), artifact("a", 2)]), /different saved Artifact/);
  assert.throws(() => create([artifact("other", 2, 13)]), /active saved Artifact in this Project/);
  assert.throws(() => create([{ ...artifact("archived", 2), status: "archived" }]), /active saved Artifact/);
  assert.throws(() => create([artifact("zero", 0)]), /active saved Artifact/);
  assert.throws(() => create([artifact("fraction", 1.5)]), /active saved Artifact/);
  assert.throws(() => create(Array.from({ length: MAX_BRIEFING_SOURCES + 1 }, (_, i) => artifact(String(i), 1))), /between 1 and 8/);
});

test("reviewed source identity never silently upgrades when its saved version or metadata changes", () => {
  const selected = artifact("a", 3);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected }, 11), true);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected, headVersion: 4 }, 11), false);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected, title: "Renamed" }, 11), false);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected, kind: "table" }, 11), false);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected, status: "archived" }, 11), false);
  assert.equal(isReviewedBriefingSourceCurrent(selected, { ...selected, projectId: 22 }, 11), false);
  assert.equal(isReviewedBriefingSourceCurrent(selected, undefined, 11), false);
});

test("bounded title and authored introduction; defaults never claim source contents or rights", () => {
  assert.throws(() => buildProjectBriefingReport({
    projectId: 11, title: " ", introduction: "", sources: [artifact("a", 1)],
  }), /briefing title/);
  assert.throws(() => buildProjectBriefingReport({
    projectId: 11, title: "Valid title", introduction: "x".repeat(2001), sources: [artifact("a", 1)],
  }), /2,000/);
  const result = buildProjectBriefingReport({
    projectId: 11, title: "Valid title", introduction: "", sources: [artifact("a", 1)],
  });
  assert.match(result.content.blocks[1].text, /References are not citations/);
  assert.match(result.content.blocks.find(block => block.id === "briefing-frame-1-review")?.text ?? "", /No content has been copied/);
});


const recordedVisual = (id: string, projectId = 11, version = 3): PinnedBriefingVisual => ({
  artifactId: id, projectId, version, title: "Saved " + id,
  contentHash: "a".repeat(64), sourceRefs: ["source:recorded"],
  content: { kind: "chart", chartType: "line", rendererPreference: "recharts",
    series: [{ id: "s1", label: "Observed", points: [{ x: "2026", y: 42 }] }], options: {} },
});

test("D06 a verified pinned chart remains visible only while its exact selected source is live", () => {
  const selected = artifact("figure", 3);
  const pinned = recordedVisual("figure");
  const live = new Map([[selected.id, selected]]);
  assert.deepEqual(currentProjectBriefingVisuals([pinned], [selected], live, 11), [pinned]);
  assert.deepEqual(currentProjectBriefingVisuals([pinned], [], live, 11), [],
    "visual must disappear immediately when removed from selection");
  assert.deepEqual(currentProjectBriefingVisuals([pinned], [selected], live, 22), [],
    "visual must never cross Projects");
  assert.deepEqual(currentProjectBriefingVisuals([pinned], [selected], live, 0), [],
    "invalid Project identity fails closed");
  assert.deepEqual(currentProjectBriefingVisuals([{ ...pinned, projectId: 22 }], [selected], live, 11), [],
    "wrong-Project P4 pin cannot be displayed");
  assert.deepEqual(currentProjectBriefingVisuals([{ ...pinned, version: 5 }], [selected], live, 11), [],
    "wrong-version P4 pin cannot be displayed");
  assert.deepEqual(currentProjectBriefingVisuals([{ ...pinned,
    content: { kind: "table", columns: [{ key: "x", label: "X", type: "number" }], rows: [{ x: 42 }] } }],
    [selected], live, 11), [], "a forged kind swap cannot be displayed");
});

test("D06 revoked, renamed, archived and superseded saved visuals fail closed before report review", () => {
  const selected = artifact("figure", 3);
  const pinned = recordedVisual("figure");
  const view = (changed: BriefingSource | undefined) =>
    currentProjectBriefingVisuals([pinned], [selected],
      changed ? new Map([[selected.id, changed]]) : new Map<string, BriefingSource>(), 11);
  assert.deepEqual(view(undefined), [], "revocation drops the visual");
  assert.deepEqual(view({ ...selected, headVersion: 4 }), [], "new head requires renewed review");
  assert.deepEqual(view({ ...selected, title: "Other source" }), [], "renamed saved source requires review");
  assert.deepEqual(view({ ...selected, status: "archived" }), [], "archived source cannot be previewed");
  assert.deepEqual(view({ ...selected, projectId: 22 }), [], "revoked Project membership denies preview");
  assert.deepEqual(view({ ...selected, kind: "table" }), [], "kind changes deny chart preview");
  assert.deepEqual(view(selected), [pinned], "unchanged authorized source remains usable");
  assert.equal(selected.headVersion, 3, "read-only filter never mutates reviewed version");
  assert.equal(pinned.version, 3, "read-only filter never mutates P4 payload");
});

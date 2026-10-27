import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProjectBriefingReport, MAX_BRIEFING_SOURCES, type BriefingSource,
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

import test from "node:test";
import assert from "node:assert/strict";
import { pulseProjectMonitorDraft } from "./pulseProjectMonitorDraft";
import { p9WorkflowDefinitionInputSchema } from "@shared/p9AutomationContracts";

const story = {
  subjectKey: "Solar Power",
  evidence: [{ id: "recorded:1", source: "Public source", url: "https://example.com/news" }],
};

test("A08 followed subject yields ONLY existing paused, Project-wide P9 monitoring action", () => {
  const draft = pulseProjectMonitorDraft(story, 60);
  assert.deepEqual(p9WorkflowDefinitionInputSchema.parse(draft), draft);
  assert.equal(draft.enabled, false);
  assert.equal(draft.name, "Project what changed");
  assert.equal(draft.template, "custom");
  assert.deepEqual(draft.trigger, { type: "schedule", schedule: { kind: "interval", everyMinutes: 60 } });
  assert.deepEqual(draft.action, { kind: "project_what_changed" });
  assert.deepEqual(draft.sourceRefs, []);
  assert.match(draft.description, /SOLAR POWER/);
  assert.match(draft.description, /NOT filtered to that subject/);
  assert.deepEqual(draft.notificationPolicy.channels, ["in_app"]);
});

test("A08 refuses missing subject/source and invalid intervals before any P9 create request", () => {
  assert.throws(() => pulseProjectMonitorDraft({ ...story, subjectKey: "" }, 60));
  assert.throws(() => pulseProjectMonitorDraft({ ...story, evidence: [] }, 60));
  assert.throws(() => pulseProjectMonitorDraft({ ...story, subjectKey: "javascript:evil()" }, 60));
  for (const minutes of [0, 4, 10081, 15.5, NaN, Infinity]) {
    assert.throws(() => pulseProjectMonitorDraft(story, minutes));
  }
});

test("A08 review never invents a provider monitor, user scope, source membership or live execution", () => {
  const draft = pulseProjectMonitorDraft({ ...story, symbol: "SOLAR" }, 1440);
  assert.equal(draft.enabled, false);
  assert.deepEqual(draft.artifactRefs, []);
  assert.deepEqual(draft.engineRefs, ["lios.project-intelligence"]);
  assert.equal(draft.action.kind, "project_what_changed");
  assert.doesNotMatch(draft.description, /https?:\/\//);
});

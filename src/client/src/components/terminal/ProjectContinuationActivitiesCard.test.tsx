import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectContinuationActivitiesCard, MAX_VISIBLE_CONTINUATION_ITEMS } from "./ProjectContinuationActivitiesCard";
import type { P6ContinuationItem } from "@shared/p6ContinuityContracts";

const recorded: P6ContinuationItem = {
  id: "follow-1", title: "Review saved decision", summary: "Recorded human-authored note",
  kind: "complete_decision", priority: "high", sourceRefs: ["source-1"], artifactRefs: ["artifact-1"],
  decisionArtifactId: "decision-1", workflowId: null, deterministic: true,
};

test("Watermelon-adapted P6 activity card presents exact recorded follow-up with existing action", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectContinuationActivitiesCard, {
    items: [recorded], onOpenDecision: () => {}, onReviewWorkflow: () => {},
  }));
  assert.match(html, /aria-label="Project continuation activities"/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /Recorded human-authored note/);
  assert.match(html, /Review saved decision/);
  assert.match(html, /1 source refs · 1 artifact refs/);
  assert.match(html, /high priority/);
  assert.match(html, /Open decision/);
  assert.doesNotMatch(html, /Review workflow/);
  assert.doesNotMatch(html, /demo|mock|fictional/);
});

test("project activity card does not imply actions when callbacks unavailable", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectContinuationActivitiesCard, {
    items: [{...recorded, id: "workflow", decisionArtifactId: null, workflowId: "run-1", priority: "medium"}],
  }));
  assert.match(html, /1 recorded follow-up/);
  assert.doesNotMatch(html, /<button[^>]*>Review workflow/);
});

test("unavailable, loading, and no records are distinct and never inferred", () => {
  const render = (args: {loading?: boolean; unavailable?: boolean; items: P6ContinuationItem[]}) =>
    renderToStaticMarkup(React.createElement(ProjectContinuationActivitiesCard, args));
  assert.match(render({items: [], unavailable: true}), /No work items or actions are inferred/);
  assert.match(render({items: [], loading: true}), /Loading Project continuation state/);
  assert.match(render({items: []}), /No deterministic follow-up/);
  assert.equal(MAX_VISIBLE_CONTINUATION_ITEMS, 8);
});

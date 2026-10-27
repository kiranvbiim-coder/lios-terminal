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


// The P6 continuity owner, not this visual component, controls read/write
// policy and all actions. The integration is a replacement, not a second list.
test("Project Continuity mounts one Watermelon-derived P6 view using canonical queue and decision actions", async () => {
  const { readFileSync } = await import("node:fs");
  const owner = readFileSync(new URL("./ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  assert.match(owner, /<ProjectContinuationActivitiesCard/);
  assert.ok(owner.includes("items={snapshot?.continuationQueue ?? []}"));
  assert.ok(owner.includes("onOpenDecision={onFocusArtifact}"));
  assert.ok(owner.includes("onReviewWorkflow={reviewExactWorkflow}"));
  assert.equal(owner.includes("(snapshot?.continuationQueue ?? []).slice(0, 8).map"), false);
  assert.match(owner, /<ProjectChangeActivity/);
});

test("Project Continuity workflow review targets an exact P9 workflow in the same Project", async () => {
  const { readFileSync } = await import("node:fs");
  const continuity = readFileSync(new URL("./ProjectContinuityPanel.tsx", import.meta.url), "utf8");
  const automations = readFileSync(new URL("./ProjectAutomationPanel.tsx", import.meta.url), "utf8");
  const focus = readFileSync(new URL("../../lib/projectWorkflowFocus.ts", import.meta.url), "utf8");
  assert.ok(automations.includes("data-p9-workflow-id={workflow.id}"));
  assert.ok(automations.includes("data-p9-project-id={projectId}"));
  assert.ok(automations.includes("tabIndex={-1}"));
  assert.ok(continuity.includes("focusProjectWorkflowRow(document, projectId, workflowId, prefersReducedMotion)"));
  assert.ok(focus.includes('panel.getAttribute("data-p9-project-id") !== String(projectId)'));
  assert.ok(focus.includes('row.getAttribute("data-p9-workflow-id") === workflowId'));
  assert.ok(focus.includes('row.focus({ preventScroll: true })'));
  assert.ok(focus.includes('row.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth"'));
  assert.ok(continuity.includes("prefers-reduced-motion: reduce"));
  assert.ok(continuity.includes("This exact workflow is not visible"));
  assert.equal(continuity.includes('onReviewWorkflow={() => document.querySelector'), false);
});

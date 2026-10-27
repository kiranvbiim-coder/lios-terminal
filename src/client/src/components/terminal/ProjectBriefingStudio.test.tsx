import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectBriefingStudio } from "./ProjectBriefingStudio";
import type { BriefingSource } from "@/lib/projectBriefingStoryboard";

const sources: BriefingSource[] = [
  { id: "a", projectId: 11, title: "Observed research record", status: "active", kind: "research", headVersion: 4 },
  { id: "other", projectId: 22, title: "Cross project secret", status: "active", kind: "chart", headVersion: 1 },
  { id: "archived", projectId: 11, title: "Archived chart", status: "archived", kind: "chart", headVersion: 5 },
];

test("Briefing Studio renders a readable source chooser, review lane and explicit save without copied content", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectBriefingStudio, {
    projectId: 11, artifacts: sources, onClose: () => {}, onOpenSource: () => {}, onSave: async () => {},
  }));
  assert.match(html, /aria-label="Project Briefing Studio"/);
  assert.match(html, /Saved Project sources/);
  assert.match(html, /Observed research record/);
  assert.match(html, /saved v4/);
  assert.match(html, /Storyboard · review order/);
  assert.match(html, /Save as Project Report/);
  assert.match(html, /disabled/);
  assert.match(html, /Close Briefing Studio/);
  assert.doesNotMatch(html, /project-artifact-exact-preview/); // Lazy until explicit Inspect selection.
  assert.match(html, /No content has been copied|never generated or copied automatically/i);
  assert.doesNotMatch(html, /Cross project secret|Archived chart/);
});

test("empty authorized source collection has honest state and no enabled save", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectBriefingStudio, {
    projectId: 11, artifacts: [], onClose: () => {}, onOpenSource: () => {}, onSave: async () => {},
  }));
  assert.match(html, /No saved Project sources match/);
  assert.match(html, /Nothing is created until you choose Save/);
  assert.match(html, /<button[^>]*disabled[^>]*>[^<]*(?:<svg[^>]*>.*<\/svg>)?[^<]*Save as Project Report/s);
});

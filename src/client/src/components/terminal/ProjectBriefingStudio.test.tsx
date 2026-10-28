import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("D01 Project switching cannot display or save stale source selections or late P4 visual results", () => {
  const src = readFileSync(new URL("./ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /activeProjectRef\.current = projectId/);
  assert.match(src, /setTitle\("My intelligence briefing"\)/);
  assert.match(src, /setIntroduction\(""\)/);
  assert.match(src, /if \(pinningId === id\) \{ visualRequestRef\.current\?\.abort\(\)/);
  assert.match(src, /visualRequestRef\.current\?\.abort\(\)/);
  assert.match(src, /signal: controller\.signal/);
  assert.match(src, /controller\.signal\.aborted \|\| activeProjectRef\.current !== inspectedProject/);
  assert.match(src, /selectedSources\.filter\(source => source\.projectId === projectId\)/);
  assert.match(src, /pinnedVisuals\.filter\(visual => visual\.projectId === projectId/);
  assert.match(src, /if \(activeProjectRef\.current !== reviewedProject\) return/);
  assert.match(src, /buildProjectBriefingReport\(\{ projectId, title, introduction, sources: chosen, visuals: currentVisuals \}\)/);
  assert.match(src, /await onSave\(chosen, title, introduction, currentVisuals\)/);
  assert.match(src, /inFlight\.current\?\.projectId === projectId/);
  assert.match(src, /const nextSaveToken = useRef\(0\)/);
  assert.match(src, /inFlight\.current\?\.token === saveToken/);
  assert.match(src, /if \(activeProjectRef\.current === reviewedProject\) setBusy\(false\)/);
  assert.match(src, /credentials: "same-origin", cache: "no-store"/);
  assert.doesNotMatch(src, /navigator\.geolocation|new WebSocket|createP9Workflow|generateImage/);
});

test("D01/D02 briefing offers source-ID search and readable accessible movement targets", () => {
  const src = readFileSync(new URL("./ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /item\.id\.toLocaleLowerCase\(\)\.includes/);
  assert.match(src, /Find by saved title, type or Artifact ID/);
  assert.match(src, /min-h-11 min-w-11 place-items-center/);
  assert.match(src, /Move \$\{source\.title\} earlier/);
  assert.match(src, /Move \$\{source\.title\} later/);
  assert.match(src, /No saved Project sources match this search in the current Project/);
});

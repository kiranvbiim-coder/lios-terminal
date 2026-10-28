import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectBriefingStudio } from "./ProjectBriefingStudio";
import { GalleryRecordedPreviewContent } from "./ProjectArtifactGalleryPreview";
import type { ArtifactContent } from "@shared/artifactContracts";
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
  assert.match(src, /currentProjectBriefingVisuals\(pinnedVisuals, chosen, byId, projectId\)/);
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
  assert.match(src, /aria-label="Close Briefing Studio"\s*\n\s*className="grid min-h-11 min-w-11/);
  assert.match(src, /placeholder="Find by saved title, type or Artifact ID…"\s*\n\s*className="min-h-11 w-full/);
  const preview = readFileSync(new URL("./ProjectArtifactGalleryPreview.tsx", import.meta.url), "utf8");
  assert.match(preview, /onClick=\{onOpen\} className="inline-flex min-h-11 items-center/);
  assert.match(src, /Move \$\{source\.title\} earlier/);
  assert.match(src, /Move \$\{source\.title\} later/);
  assert.match(src, /No saved Project sources match this search in the current Project/);
});

test("D04 quiet storyboard review stays opt-in, reversible and source-preserving", () => {
  const html = renderToStaticMarkup(React.createElement(ProjectBriefingStudio, {
    projectId: 11, artifacts: sources, onClose: () => {}, onOpenSource: () => {}, onSave: async () => {},
  }));
  // Default remains full discovery; no hidden source choice or automatic save.
  assert.match(html, /Focus on selected briefing storyboard/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Choose Project sources/);
  assert.match(html, /Observed research record/);

  const src = readFileSync(new URL("./ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /const \[quietReview, setQuietReview\] = useState\(false\)/);
  assert.match(src, /onClick=\{\(\) => setQuietReview\(current => !current\)\}/);
  assert.match(src, /\{!quietReview && <section/);
  assert.match(src, /quietReview \? "grid-cols-1" : "xl:grid-cols-2"/);
  assert.match(src, /setQuietReview\(false\)/); // Project switching resets view preference.
  assert.match(src, /selectedSources\.filter\(source => source\.projectId === projectId\)/);
  assert.match(src, /await onSave\(chosen, title, introduction, currentVisuals\)/);
  assert.doesNotMatch(src, /localStorage|sessionStorage|setTimeout|createP9Workflow/);
});

test("D06 visible Project authority follows live Artifact changes without cached metadata", () => {
  const src = readFileSync(new URL("./ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /const byId = new Map\(available\.map\(item => \[item\.id, item\]\)\)/);
  assert.doesNotMatch(src, /useMemo\(\(\) => new Map\(available/);
  assert.match(src, /visual\.title !== source\.title/);
  assert.match(src, /visual\.content\.kind !== source\.kind/);
  assert.match(src, /currentProjectBriefingVisuals\(pinnedVisuals, chosen, byId, projectId\)/);
});

test("D05 shows only exact P4 native visuals with explicit bounded recorded preview", () => {
  const chart = {
    kind: "chart", chartType: "line", rendererPreference: "recharts",
    series: [{ id: "actual", label: "Verified Q2 data", points: [{ x: "2025", y: 12 }, { x: "2026", y: 18 }] }],
    options: {},
  } as ArtifactContent;
  const table = {
    kind: "table", columns: [{ key: "period", label: "Period", type: "string" },
      { key: "value", label: "Observed amount", type: "number" }],
    rows: [{ period: "2025", value: 12 }, { period: "2026", value: 18 }],
  } as ArtifactContent;
  const chartHtml = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: chart }));
  const tableHtml = renderToStaticMarkup(React.createElement(GalleryRecordedPreviewContent, { content: table }));
  assert.match(chartHtml, /First 2 saved chart positions/);
  assert.match(chartHtml, /Verified Q2 data/);
  assert.match(tableHtml, /Observed amount/);
  assert.match(tableHtml, />2026</);
  assert.doesNotMatch(chartHtml + tableHtml, /generated summary|stock image|estimated value/i);

  const empty = renderToStaticMarkup(React.createElement(ProjectBriefingStudio, {
    projectId: 11, artifacts: sources, onClose: () => {}, onOpenSource: () => {}, onSave: async () => {},
  }));
  assert.doesNotMatch(empty, /Preview recorded visual/); // No source pinned by default.
  const src = readFileSync(new URL("./ProjectBriefingStudio.tsx", import.meta.url), "utf8");
  assert.match(src, /GalleryRecordedPreviewContent content=\{visual\.content\}/);
  assert.match(src, /currentProjectBriefingVisuals\(pinnedVisuals, chosen, byId, projectId\)/);
  assert.match(src, /const \[expandedVisualId, setExpandedVisualId\] = useState<string \| null>\(null\)/);
  assert.match(src, /aria-expanded=\{expandedVisualId === visual\.artifactId\}/);
  assert.match(src, /setExpandedVisualId\(null\)/); // Project change resets preview state.
  assert.match(src, /if \(expandedVisualId === id\) setExpandedVisualId\(null\)/);
  assert.match(src, /Report save rechecks the current authorized version/);
  assert.doesNotMatch(src, /fetch\("https?:|generateImage|new Image\(/);
});

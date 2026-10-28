import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { P7ContextGraph, P7InsightLens } from "@shared/p7ResearchContracts";
import { ProjectInvestigationDesk } from "./ProjectInvestigationDesk";

const hash = "a".repeat(64);
const graph: P7ContextGraph = {
  schemaVersion: "1", projectId: 9, generatedAt: "2026-10-27T06:30:00Z", contentHash: hash,
  nodes: [{ id: "e", kind: "event", label: "Reviewed event", sourceRef: "src:e", occurredAt: null, contentHash: null, metadata: {} }],
  edges: [],
};
const lens: P7InsightLens = {
  schemaVersion: "1", projectId: 9, generatedAt: "2026-10-27T06:30:00Z",
  insights: [{ id: "i", kind: "change", title: "Observed news", summary: "Verified through a retained record",
    severity: "watch", sourceRefs: ["src:e"], entityRefs: [], deterministic: true, occurredAt: null }],
  counts: { change: 1 },
};

test("first-class Project investigation renders only exact retained evidence", () => {
  const html = renderToStaticMarkup(createElement(ProjectInvestigationDesk, {
    projectId: 9, graph, lens, onInvestigate: () => undefined,
  }));
  assert.match(html, /Observed news/);
  assert.match(html, /src:e/);
  assert.match(html, /Recorded Project insight/);
  assert.match(html, /Investigate in Chat/);
  assert.match(html, /Evidence|evidence/);
  assert.doesNotMatch(html, /<iframe|<script|href=/);
});

test("wrong Project graph/lens is never projected as local truth", () => {
  const html = renderToStaticMarkup(createElement(ProjectInvestigationDesk, {
    projectId: 10, graph, lens, onInvestigate: () => undefined,
  }));
  assert.match(html, /not available for this Project/);
  assert.doesNotMatch(html, /src:e|Observed news/);
});

test("no source insights do not yield artificial consequences or actions", () => {
  const html = renderToStaticMarkup(createElement(ProjectInvestigationDesk, {
    projectId: 9, graph, lens: { ...lens, insights: [], counts: {} },
  }));
  assert.match(html, /No recorded insights are available/);
  assert.doesNotMatch(html, /Investigate in Chat/);
});

test("C03 invalid source event date is never displayed as verified Project event history", () => {
  const invalid = { ...lens, insights: [{
    ...lens.insights[0], occurredAt: "2026-02-30T11:00:00Z",
  }] };
  const html = renderToStaticMarkup(createElement(ProjectInvestigationDesk, {
    projectId: 9, graph, lens: invalid,
  }));
  assert.match(html, /No recorded event date/);
  assert.doesNotMatch(html, /Invalid Date|2 Mar 2026/);
});

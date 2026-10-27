import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PerspectiveSource, RecordedPerspectivesBoard } from "./RecordedPerspectivesBoard";
import type { PerspectiveEvidence, PerspectiveRelation } from "@/lib/researchPerspectives";

const item = (id: number, title: string, sourceUrl: string | null = null): PerspectiveEvidence => ({
  id, title, excerpt: `Recorded excerpt for ${title}`,
  annotation: id === 1 ? "Analyst observation" : null,
  evidenceType: id === 1 ? "filing" : "internal_note",
  evidenceKind: id === 1 ? "fact" : "counterargument",
  sourceName: `Original publisher ${id}`, provider: "Research archive", sourceUrl,
  publishedAt: "2026-10-20T08:00:00.000Z", retrievedAt: "2026-10-21T08:00:00.000Z",
});
const records = [item(1,"First fact","https://recorded.example.org/filing"),item(2,"Challenge"),item(3,"Additional unlinked evidence")];
const relations: PerspectiveRelation[] = [
  { id: 50, fromEvidenceId: 1, toEvidenceId: 2, relationshipType: "contradicts", note: "Recorded reason for challenge" },
  { id: 51, fromEvidenceId: 2, toEvidenceId: 1, relationshipType: "supports", note: null },
];

function render(options: { evidence?: PerspectiveEvidence[]; relationships?: PerspectiveRelation[]; title?: string } = {}) {
  return renderToStaticMarkup(React.createElement(RecordedPerspectivesBoard, {
    title: options.title ?? "Authorized investigation",
    question: "What did the filings say?",
    thesis: "Analyst working hypothesis",
    evidence: options.evidence ?? records,
    relationships: options.relationships ?? relations,
    onOpenInvestigation: () => {},
  }));
}

test("viewer renders honest relationship lanes with two real-source details", () => {
  const html = render();
  assert.match(html, /research-perspectives-explorer/);
  assert.match(html, /Perspectives Explorer/);
  assert.match(html, /Supporting links/);
  assert.match(html, /Challenging links/);
  assert.match(html, /Other relationships/);
  assert.match(html, /Recorded reason for challenge/);
  assert.match(html, /perspectives-source-comparison/);
  assert.match(html, /First fact/);
  assert.match(html, /Challenge/);
  assert.match(html, /Analyst working hypothesis/);
  assert.match(html, /Open investigation/);
});

test("verified recorded HTTPS source can open; no external image or fabricated article links", () => {
  const html = renderToStaticMarkup(React.createElement(PerspectiveSource, { item: records[0] }));
  assert.match(html, /href="https:\/\/recorded.example.org\/filing"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /Original publisher 1/);
  assert.match(html, /Analyst observation/);
  assert.doesNotMatch(html, /<img\b|<iframe\b/);
});

test("unsafe source links, missing citations and hostile text are not executed", () => {
  const html = renderToStaticMarkup(React.createElement(PerspectiveSource, {
    item: { ...records[0], title: "<script>alert('x')</script>",
      excerpt: '<img src="spy">', sourceUrl: "javascript:alert(1)" },
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=&quot;spy&quot;&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b|href="javascript:/);
  assert.match(html, /No safe source URL recorded/);
});

test("records with no links are kept visible as unlinked, not falsely labeled neutral or supportive", () => {
  const html = render({ relationships: [] });
  assert.match(html, /Evidence without recorded links · 3/);
  assert.match(html, /No recorded evidence links match/);
  assert.match(html, /not that a source is neutral/);
  assert.doesNotMatch(html, /data-perspective-link=/);
});

test("empty investigation is a truthful call to action, not demo evidence", () => {
  const html = render({ evidence: [], relationships: [] });
  assert.match(html, /No retained evidence yet/);
  assert.doesNotMatch(html, /data-perspective-link=|data-perspective-evidence=/);
});

test("invalid source relation endpoints remain undisplayed while count is visible", () => {
  const html = render({ evidence: records.slice(0,1), relationships: relations });
  assert.match(html, /2 relationships have unavailable evidence endpoints/);
  assert.doesNotMatch(html, /data-perspective-link=/);
});

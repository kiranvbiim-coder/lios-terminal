import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  evidenceDateLabels, filterResearchEvidence, recordedEvidenceHttpUrl,
  ResearchEvidenceCard, ResearchEvidenceComparison,
  type ResearchEvidenceRecord,
} from "./ResearchEvidencePresentation";

const recorded: ResearchEvidenceRecord = {
  id: 72,
  evidenceType: "filing",
  evidenceKind: "fact",
  title: "Published operating update",
  excerpt: "Recorded revenue was 52 for the reported period.",
  annotation: "Compare reported periods before drawing conclusions.",
  sourceName: "Public filing",
  provider: "Official registry",
  sourceUrl: "https://filings.example.org/report/42",
  publishedAt: "2026-10-22T10:00:00.000Z",
  effectiveAt: "2026-10-21T00:00:00.000Z",
  retrievedAt: "2026-10-23T08:00:00.000Z",
};

test("research evidence cards show existing source, excerpt, author note and bounded rubric", () => {
  const markup = renderToStaticMarkup(React.createElement(ResearchEvidenceCard, {
    item: recorded, score: 74, selectedForCompare: false, onCompare: () => {},
  }));
  assert.match(markup, /data-research-evidence-card="true"/);
  assert.match(markup, /Published operating update/);
  assert.match(markup, /Recorded revenue was 52/);
  assert.match(markup, /Compare reported periods/);
  assert.match(markup, /Source-quality rubric 74\/100/);
  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /aria-pressed="false"/);
  assert.match(markup, /href="https:\/\/filings.example.org\/report\/42"/);
  assert.doesNotMatch(markup, /<img\b|<iframe\b/);
});

test("only exact recorded safe HTTP links become clickable; source homepages are not inferred", () => {
  assert.equal(recordedEvidenceHttpUrl("https://filings.example.org/report/42"), recorded.sourceUrl);
  assert.equal(recordedEvidenceHttpUrl(null), null);
  for(const link of ["javascript:alert(1)", "file:///etc/passwd", "mailto:editor@example.org", "https://username:pass@example.org/path", "https://safe.example.org/a\nurl"]) {
    assert.equal(recordedEvidenceHttpUrl(link), null);
  }
  const markup = renderToStaticMarkup(React.createElement(ResearchEvidenceCard, {
    item: { ...recorded, sourceUrl: "javascript:alert(1)" },
    score: 74, selectedForCompare: true, onCompare: () => {},
  }));
  assert.match(markup, /No verified source URL recorded/);
  assert.match(markup, /aria-pressed="true"/);
  assert.doesNotMatch(markup, /href="javascript:/);
});

test("filters use exactly recorded fields without inventing related evidence", () => {
  const items = [
    recorded,
    { ...recorded, id: 73, evidenceType: "news", evidenceKind: "interpretation", title: "Regional analysis", excerpt: null, sourceName: "Newswire", provider: "News service" },
  ];
  assert.deepEqual(filterResearchEvidence(items, "revenue", "all").map(x => x.id), [72]);
  assert.deepEqual(filterResearchEvidence(items, "regional", "filing").map(x => x.id), []);
  assert.deepEqual(filterResearchEvidence(items, "WIRE", "news").map(x => x.id), [73]);
  assert.deepEqual(filterResearchEvidence(items, "", "all").map(x => x.id), [72, 73]);
  assert.deepEqual(items.map(x => x.id), [72, 73], "filter must not change ledger order or identity");
});

test("comparison shows two exact retained records but never claims they agree", () => {
  const html = renderToStaticMarkup(React.createElement(ResearchEvidenceComparison, {
    first: recorded,
    second: { ...recorded, id: 73, title: "Recorded counterpoint", evidenceKind: "counterargument",
      excerpt: "Another source reported 48, covering a different period.", sourceUrl: null },
    onClear: () => {},
  }));
  assert.match(html, /data-testid="research-evidence-side-by-side"/);
  assert.match(html, /Recorded revenue was 52/);
  assert.match(html, /Another source reported 48/);
  assert.match(html, /source facts only; no inferred agreement/);
  assert.match(html, /E72/);
  assert.match(html, /E73/);
  assert.doesNotMatch(html, /contradiction detected|verified match/i);
});

test("untrusted evidence strings remain escaped; invalid and missing dates stay explicit", () => {
  const html = renderToStaticMarkup(React.createElement(ResearchEvidenceCard, {
    item: { ...recorded, title: "<script>alert('x')</script>", excerpt: "<img src=x onerror=alert(1)>",
      publishedAt: null, effectiveAt: "broken", retrievedAt: "2026-10-23T08:00:00.000Z" },
    score: 31, selectedForCompare: false, onCompare: () => {},
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x/);
  assert.doesNotMatch(html, /<script\b|<img\b/);
  assert.deepEqual(evidenceDateLabels({ publishedAt: null, effectiveAt: "invalid", retrievedAt: "2026-10-23T08:00:00.000Z" }).published, "Not recorded");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import NewsEditorialStoryCard from "./NewsEditorialStoryCard";

function renderStory(overrides: Record<string, unknown> = {}) {
  const props = {
    title: "Verified policy update",
    summary: "A published report with a recorded source.",
    source: "Official bulletin",
    publishedAt: "2026-10-27T08:00:00.000Z",
    ageLabel: "2h ago",
    sentiment: "neutral" as const,
    statusBadge: createElement("span", null, "Recorded"),
    active: false,
    lead: false,
    onSelect: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(NewsEditorialStoryCard, props));
}

test("editorial cards preserve the source, recorded freshness badge and exact published time", () => {
  const html = renderStory();
  assert.match(html, /data-news-editorial-card="true"/);
  assert.match(html, /data-analytical-row/);
  assert.match(html, /Official bulletin/);
  assert.match(html, /Verified policy update/);
  assert.match(html, /Recorded/);
  assert.match(html, /2026-10-27T08:00:00/);
  assert.match(html, /2h ago/);
});

test("selection and featured presentation are explicit and keyboard accessible", () => {
  const html = renderStory({ active: true, lead: true });
  assert.match(html, /type="button"/);
  assert.match(html, /aria-pressed="true"/);
  assert.match(html, /focus-visible:outline/);
  assert.match(html, /Story overview/);
  assert.match(html, /Reading in the source pane/);
});

test("source card never invents or fetches media; untrusted strings are escaped", () => {
  const html = renderStory({ title: '<img src="https://not-authorized.example/spy">', summary: "<script>alert(1)</script>" });
  assert.doesNotMatch(html, /<img\b|<script\b|<iframe\b/);
  assert.doesNotMatch(html, /src="https:\/\/not-authorized/);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

test("unselected card offers source readthrough without duplicate modal or link", () => {
  const html = renderStory({ active: false, lead: false });
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /Open story and inspect source/);
  assert.doesNotMatch(html, /role="dialog"|target="_blank"|<img\b/);
});

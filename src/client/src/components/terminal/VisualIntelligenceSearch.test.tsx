import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { IntelligenceCard } from "@shared/waveDContracts";
import VisualIntelligenceSearch, { VisualIntelligenceResultCard } from "./VisualIntelligenceSearch";

const card: IntelligenceCard = {
  id: "evidence-case", kind: "research", priority: "important", title: "Water source publication",
  whatHappened: "A sourced observation was recorded", whyItMatters: "Potential impact",
  whyItMattersToUser: "Relevant to user's investigation", nextActions: ["ask"],
  createdAt: "2026-10-27T06:00:00Z", score: 62, status: "unread", unread: true,
  evidence: [
    { id: "public", source: "Public document", url: "https://example.org/public-report" },
    { id: "bad", source: "<unsafe>", url: "javascript:alert(1)" },
    { id: "secret", source: "Private URL", url: "https://example.org/doc?api_key=PRIVATE" },
  ],
};

test("visual results expose recorded evidence and source-safe links, not images or preview fetches", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card, disabled: false, onAsk: () => undefined,
  }));
  assert.match(html, /Water source publication/);
  assert.match(html, /Recorded sources \(3\)/);
  assert.match(html, /Ask LiOS/);
  assert.equal((html.match(/href="https:\/\/example.org\/public-report"/g) ?? []).length, 1);
  assert.doesNotMatch(html, /href="javascript:|href="https:\/\/example.org\/doc|PRIVATE|<img\b/);
  assert.match(html, /&lt;unsafe&gt;/);
});

test("unavailable or short queries do not render a synthetic intelligence gallery", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceSearch, {
    query: "x", onAsk: () => true,
  }));
  assert.match(html, /Enter at least 2 characters/);
  assert.doesNotMatch(html, /lios-visual-intelligence-result|href=|fetching/);
});

test("Ask LiOS is a user-triggered action and respects parent denial", () => {
  const html = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card, disabled: true, onAsk: () => undefined,
  }));
  assert.match(html, /disabled/);
});

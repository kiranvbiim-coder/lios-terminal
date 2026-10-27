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


test("Search uses existing approved local images without fetching publisher pixels", () => {
  const image = {
    kind: "image" as const,
    assetPath: "/editorial-media/" + "b".repeat(64) + ".webp",
    sha256: "b".repeat(64),
    alt: "Original evidence image cleared for the recorded source",
    attribution: "Original publisher",
    owner: "Rights-granting publisher",
    licenseName: "Licensed reuse",
    licenseEvidenceRef: "license:source:reviewed",
    sourceEvidenceId: "public",
    verifiedBy: "authorized-editor",
    verifiedAt: "2026-10-26T00:00:00Z",
    permission: "commercial_redistribution_and_display" as const,
    offlineBundlingPermitted: true as const,
    state: "approved" as const,
  };
  const permitted = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card: { ...card, media: image }, disabled: false, onAsk: () => undefined,
  }));
  assert.match(permitted, /licensed-editorial-image/);
  assert.match(permitted, /src="\/editorial-media\/b{64}\.webp"/);
  assert.match(permitted, /Ask LiOS/);
  const unlinked = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card: { ...card, media: { ...image, sourceEvidenceId: "unrelated" } }, disabled: false, onAsk: () => undefined,
  }));
  assert.doesNotMatch(unlinked, /<img\b/);
  assert.match(unlinked, /Water source publication/);
});


test("A07 shows optional rights-safe context when a recorded image fails source-rights checks", () => {
  const invalid = {
    kind: "image", assetPath: "/editorial-media/" + "a".repeat(64) + ".webp",
    sha256: "a".repeat(64), alt: "Rights not linked to this source",
    attribution: "Unknown", owner: "Unknown", licenseName: "unverified",
    licenseEvidenceRef: "none", sourceEvidenceId: "unrelated",
    verifiedBy: "none", verifiedAt: "2026-10-27T00:00:00Z",
    permission: "commercial_redistribution_and_display", offlineBundlingPermitted: true,
    state: "approved",
  };
  const html = renderToStaticMarkup(createElement(VisualIntelligenceResultCard, {
    card: { ...card, title: "Solar power stocks rise on report", media: invalid as IntelligenceCard["media"] },
    disabled: false, onAsk: () => undefined,
  }));
  assert.doesNotMatch(html, /<img\b|src="\/editorial-media/);
  assert.match(html, /Find context picture/);
  assert.match(html, /after your click/);
  assert.match(html, /Recorded sources \(3\)/);
});
